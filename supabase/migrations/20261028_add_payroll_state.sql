-- The payroll app's working data (Admin → Payroll), shared by every HR admin
-- and super admin instead of living in one browser. One row per piece:
--   employees  the payroll roster
--   settings   company, rates and rules
--   holidays   the holiday calendar, all years
--   dtr|<cutoff>|<employee id>  one person's timesheet and amounts for a cutoff
-- so two admins editing different people on the same cutoff never overwrite
-- each other.
CREATE TABLE IF NOT EXISTS public.payroll_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id)
);

ALTER TABLE public.payroll_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_state_admin ON public.payroll_state;
CREATE POLICY payroll_state_admin ON public.payroll_state
  FOR ALL USING (public.get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (public.get_user_role() IN ('hr_admin', 'super_admin'));
