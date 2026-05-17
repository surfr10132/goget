import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="text-center pt-6 pb-2">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Find <span className="text-brand-600">anything</span> in Indonesia.
        </h1>
        <p className="mt-3 text-gray-600 max-w-xl mx-auto">
          Describe what you need in plain words. We find it at a local store
          and have a runner deliver it the same day via GoSend or Grab.
        </p>
      </section>

      <SearchBox />

      <section className="grid sm:grid-cols-3 gap-4 pt-6">
        {[
          { title: "Search", body: "Type what you need, or paste a product link from any store." },
          { title: "Compare", body: "We show stores, prices, and the cheapest courier." },
          { title: "Track", body: "Live driver location until it lands at your door." },
        ].map(card => (
          <div key={card.title} className="rounded-2xl border border-gray-100 p-5">
            <div className="font-semibold">{card.title}</div>
            <div className="text-sm text-gray-600 mt-1">{card.body}</div>
          </div>
        ))}
      </section>

      <section className="pt-6 text-center text-sm text-gray-500">
        Already have an order? <Link className="text-brand-600 underline" href="/orders">Track it →</Link>
      </section>
    </div>
  );
}
