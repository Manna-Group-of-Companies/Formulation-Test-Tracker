-- Raw materials by weight: each material's quantity in grams, instead of a
-- percentage of the reactor charge. formulations.materials is now
-- [{name, grams}]. There is no total to reach, so the 100 % check is gone;
-- each quantity just has to be a weight of 0 g or more.
--
-- Safe to run more than once.

comment on column public.formulations.materials is 'Raw materials as [{name, grams}]: each material''s weight in grams';

create or replace function tracker_private.clean_materials(list jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare out jsonb := '[]'; m jsonb; nm text; g numeric; n int := 0;
begin
  if list is null or jsonb_typeof(list) <> 'array' then return '[]'; end if;
  for m in select value from jsonb_array_elements(list) loop
    n := n + 1;
    exit when n > 30;
    nm := left(tracker_private.txt(m -> 'name'), 60);
    g := tracker_private.num(m -> 'grams');
    continue when nm is null and g is null;
    if nm is null then perform tracker_private.fail('give a name for the material weighing ' || g || ' g'); end if;
    if g is null then perform tracker_private.fail('enter the weight in grams for ' || nm); end if;
    if g < 0 then perform tracker_private.fail(nm || ': the weight can''t be negative'); end if;
    if g >= 1000000000 then perform tracker_private.fail(nm || ': that weight is too large — enter it in grams'); end if;
    out := out || jsonb_build_array(jsonb_build_object('name', nm, 'grams', g));
  end loop;
  return out;
end $$;

revoke all on function tracker_private.clean_materials(jsonb) from public, anon, authenticated;
