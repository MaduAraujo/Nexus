DO $$
DECLARE
  r      RECORD;
  v_qual TEXT;
  v_chk  TEXT;
  v_sql  TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual ~ '(is_rh|my_employee_id|auth\.uid)\(\)' OR with_check ~ '(is_rh|my_employee_id|auth\.uid)\(\)')
  LOOP
    v_qual := regexp_replace(r.qual, '(?<!SELECT )\m(is_rh|my_employee_id|auth\.uid)\(\)', '(SELECT \1())', 'g');
    v_chk  := regexp_replace(r.with_check, '(?<!SELECT )\m(is_rh|my_employee_id|auth\.uid)\(\)', '(SELECT \1())', 'g');
    IF v_qual IS NOT DISTINCT FROM r.qual AND v_chk IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;
    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_qual);
    END IF;
    IF v_chk IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_chk);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;
