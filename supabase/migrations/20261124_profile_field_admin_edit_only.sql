-- "Only HR admins can edit" for a profile field (24 Nov 2026).
-- Current Salary drives payroll rates, so the employee must not be able to
-- write their own entries. Until now the self-write policies let anyone
-- insert/update/delete their own rows of any non-hr_only field directly
-- through the API, whatever the profile page showed. Admin writes
-- (pfvr_write_admin / profile_field_values_write_admin) and approved
-- pending changes (service role) are unaffected.

ALTER TABLE public.profile_fields
  ADD COLUMN IF NOT EXISTS admin_edit_only BOOLEAN NOT NULL DEFAULT false;

UPDATE public.profile_fields SET admin_edit_only = true
WHERE lower(label) = 'current salary';

DROP POLICY IF EXISTS profile_field_values_write_own ON public.profile_field_values;
CREATE POLICY profile_field_values_write_own ON public.profile_field_values
  FOR ALL
  USING (
    employee_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_fields f
      WHERE f.id = field_id AND (f.visibility = 'hr_only' OR f.admin_edit_only)
    )
  )
  WITH CHECK (
    employee_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_fields f
      WHERE f.id = field_id AND (f.visibility = 'hr_only' OR f.admin_edit_only)
    )
  );

DROP POLICY IF EXISTS pfvr_write_own ON public.profile_field_value_rows;
CREATE POLICY pfvr_write_own ON public.profile_field_value_rows
  FOR ALL
  USING (
    employee_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_fields f
      WHERE f.id = field_id AND (f.visibility = 'hr_only' OR f.admin_edit_only)
    )
  )
  WITH CHECK (
    employee_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_fields f
      WHERE f.id = field_id AND (f.visibility = 'hr_only' OR f.admin_edit_only)
    )
  );
