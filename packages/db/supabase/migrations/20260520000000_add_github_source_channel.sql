do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'source_channel'
      and e.enumlabel = 'github'
  ) then
    alter type source_channel add value 'github';
  end if;
end
$$;
