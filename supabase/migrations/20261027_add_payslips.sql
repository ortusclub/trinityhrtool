-- Payslips prepared on Admin → Payroll → Payslip. One row per employee per
-- cutoff; preparing a cutoff again replaces its rows. Employees see their
-- own only once the cutoff is released (payslip_releases.published_at set).
CREATE TABLE IF NOT EXISTS public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The payroll app's cutoff id, e.g. "2026-10-P25" (paid 25 Oct 2026).
  period_id TEXT NOT NULL,
  cutoff_start DATE NOT NULL,
  cutoff_end DATE NOT NULL,
  payout_date DATE NOT NULL,
  -- Earnings / deductions lines exactly as the payroll app prints them:
  -- { earnings: [{label, amount, kind?}], deductions: [...], net_taxable, … }
  lines JSONB NOT NULL,
  gross_pay NUMERIC(12, 2) NOT NULL,
  total_deductions NUMERIC(12, 2) NOT NULL,
  net_pay NUMERIC(12, 2) NOT NULL,
  remarks TEXT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prepared_by UUID REFERENCES public.users(id),
  UNIQUE (employee_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_employee
  ON public.payslips(employee_id, payout_date DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_period
  ON public.payslips(period_id);

-- A cutoff is visible to employees once published_at is set.
CREATE TABLE IF NOT EXISTS public.payslip_releases (
  period_id TEXT PRIMARY KEY,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.users(id)
);

-- What every payslip shows (a single row, id = 1).
CREATE TABLE IF NOT EXISTS public.payslip_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.users(id)
);

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_settings ENABLE ROW LEVEL SECURITY;

-- Employees: their own payslips, released cutoffs only.
DROP POLICY IF EXISTS payslips_read_own ON public.payslips;
CREATE POLICY payslips_read_own ON public.payslips
  FOR SELECT USING (
    employee_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.payslip_releases r
      WHERE r.period_id = payslips.period_id AND r.published_at IS NOT NULL
    )
  );

-- HR admins and super admins: everything, drafts included.
DROP POLICY IF EXISTS payslips_admin_all ON public.payslips;
CREATE POLICY payslips_admin_all ON public.payslips
  FOR ALL USING (public.get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (public.get_user_role() IN ('hr_admin', 'super_admin'));

DROP POLICY IF EXISTS payslip_releases_read ON public.payslip_releases;
CREATE POLICY payslip_releases_read ON public.payslip_releases
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS payslip_releases_admin ON public.payslip_releases;
CREATE POLICY payslip_releases_admin ON public.payslip_releases
  FOR ALL USING (public.get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (public.get_user_role() IN ('hr_admin', 'super_admin'));

DROP POLICY IF EXISTS payslip_settings_read ON public.payslip_settings;
CREATE POLICY payslip_settings_read ON public.payslip_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS payslip_settings_admin ON public.payslip_settings;
CREATE POLICY payslip_settings_admin ON public.payslip_settings
  FOR ALL USING (public.get_user_role() IN ('hr_admin', 'super_admin'))
  WITH CHECK (public.get_user_role() IN ('hr_admin', 'super_admin'));
