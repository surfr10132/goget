import { supabase } from "../clients";
import { bookCourierForOrder } from "../routes/orders";
import { transitionOrderStatus } from "./order-state-machine";

const BOOK_COURIER_JOB_TYPE = "book_courier" as const;
const MAX_INLINE_JOB_LIMIT = 50;

type OrderJobType = typeof BOOK_COURIER_JOB_TYPE;

type ClaimedOrderJob = {
  id: string;
  order_id: string;
  job_type: OrderJobType;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
};

export type ProcessOrderJobsResult = {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
};

export async function enqueueBookCourierJob(
  orderId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.rpc("enqueue_order_job", {
    p_order_id: orderId,
    p_job_type: BOOK_COURIER_JOB_TYPE,
    p_dedupe_key: `${BOOK_COURIER_JOB_TYPE}:${orderId}`,
    p_payload: payload,
    p_max_attempts: 6,
    p_run_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function processOrderJobs(limit = 10): Promise<ProcessOrderJobsResult> {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), MAX_INLINE_JOB_LIMIT)
    : 10;

  const { data, error } = await supabase
    .rpc("claim_order_jobs", { p_limit: safeLimit })
    .returns<ClaimedOrderJob[]>();
  if (error) throw new Error(error.message);
  const jobs = Array.isArray(data) ? data : [];
  let succeeded = 0;
  let retried = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runJob(job);
      await markJobSucceeded(job);
      succeeded += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      const exhausted = await markJobFailure(job, message);
      if (exhausted) {
        failed += 1;
        await transitionOrderStatus({
          orderId: job.order_id,
          nextStatus: "failed",
          statusReason: "courier booking retries exhausted",
          note: "courier booking retries exhausted",
          meta: { job_id: job.id, error: message },
        }).catch(transitionError => {
          // eslint-disable-next-line no-console
          console.error("failed to mark order as failed after job exhaustion", transitionError);
        });
      } else {
        retried += 1;
      }
    }
  }

  return {
    claimed: jobs.length,
    succeeded,
    retried,
    failed,
  };
}

async function runJob(job: ClaimedOrderJob): Promise<void> {
  if (job.job_type !== BOOK_COURIER_JOB_TYPE) {
    throw new Error(`unsupported job type: ${job.job_type}`);
  }

  const response = await bookCourierForOrder(
    job.order_id,
    (body, status) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  );

  if (!response.ok) {
    const payload = await readJson(response);
    const payloadError =
      isObject(payload) && typeof payload.error === "string"
        ? payload.error
        : `booking failed with status ${response.status}`;
    throw new Error(payloadError);
  }
}

async function markJobSucceeded(job: ClaimedOrderJob): Promise<void> {
  const { error } = await supabase
    .from("order_jobs")
    .update({
      status: "succeeded",
      attempt_count: job.attempt_count + 1,
      locked_at: null,
      last_error: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "processing");
  if (error) throw new Error(error.message);
}

async function markJobFailure(job: ClaimedOrderJob, message: string): Promise<boolean> {
  const nextAttempt = job.attempt_count + 1;
  const exhausted = nextAttempt >= job.max_attempts;

  if (exhausted) {
    const { error } = await supabase
      .from("order_jobs")
      .update({
        status: "failed",
        attempt_count: nextAttempt,
        locked_at: null,
        last_error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "processing");
    if (error) throw new Error(error.message);
    return true;
  }

  const retryAt = new Date(Date.now() + computeBackoffMs(nextAttempt)).toISOString();
  const { error } = await supabase
    .from("order_jobs")
    .update({
      status: "pending",
      attempt_count: nextAttempt,
      run_at: retryAt,
      locked_at: null,
      last_error: message,
    })
    .eq("id", job.id)
    .eq("status", "processing");
  if (error) throw new Error(error.message);
  return false;
}

function computeBackoffMs(attempt: number): number {
  const seconds = Math.min(15 * 2 ** attempt, 30 * 60);
  return seconds * 1000;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown job failure";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
