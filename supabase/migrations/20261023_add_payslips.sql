-- Payslips sent from the Trinity payroll site (payroll-ortus.vercel.app).
-- One row per employee per cutoff; sending a cutoff again replaces it.
-- Written only by /api/payslips/import with the service role — there is no
-- insert/update policy, so no session can write here.
CREATE TABLE IF NOT EXISTS public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The payroll site's cutoff id, e.g. "2026-10-P25" (paid 25 Oct 2026).
  period_id TEXT NOT NULL,
  cutoff_start DATE NOT NULL,
  cutoff_end DATE NOT NULL,
  payout_date DATE NOT NULL,
  -- Earnings / deductions lines exactly as the payroll site prints them:
  -- { earnings: [{label, amount, kind?}], deductions: [...], net_taxable, … }
  lines JSONB NOT NULL,
  gross_pay NUMERIC(12, 2) NOT NULL,
  total_deductions NUMERIC(12, 2) NOT NULL,
  net_pay NUMERIC(12, 2) NOT NULL,
  remarks TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee
  ON public.payslips(employee_id, payout_date DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_period
  ON public.payslips(period_id);

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

-- Read own
DROP POLICY IF EXISTS payslips_read_own ON public.payslips;
CREATE POLICY payslips_read_own ON public.payslips
  FOR SELECT USING (employee_id = auth.uid());

-- Read all (HR + super admins)
DROP POLICY IF EXISTS payslips_read_all ON public.payslips;
CREATE POLICY payslips_read_all ON public.payslips
  FOR SELECT USING (public.get_user_role() IN ('hr_admin', 'super_admin'));
