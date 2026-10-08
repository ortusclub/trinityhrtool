-- Finish the hr_support read grant: let it resolve employee NAMES.
--
-- 20260916_hr_support_read_team_requests.sql gave hr_support SELECT on the
-- four request tables, but nothing was added for public.users. /requests
-- reads names as an RLS-bound embedded join
-- (employee:users!leave_requests_employee_id_fkey(...)), and the users SELECT
-- policies only cover self / direct reports / hr_admin+super_admin. Both
-- hr_support accounts have zero direct reports, so the embed resolved to NULL
-- for every row: the queue listed the requests but each name rendered blank
-- (the row guards are `{leave.employee && ...}`), and the name search filter
-- `rows.filter(r => r.employee && ...)` matched nothing.
--
-- Deliberately SELECT-only, mirroring the 20260916 migration: no UPDATE
-- policy, so approve/reject/edit/cancel stay with the employee's manager and
-- hr_admin. RLS — not the UI gate — is what withholds those actions.
--
-- Note this is row-level, so it exposes every users column to hr_support,
-- including calendar_token (the iCal feed secret). hr_admin already has the
-- same reach and the table holds no compensation data. If that ever needs
-- narrowing, the alternative is reading names through the admin client, the
-- way /attendance/all already does.

DROP POLICY IF EXISTS users_read_hr_support ON public.users;
CREATE POLICY users_read_hr_support ON public.users
  FOR SELECT USING (public.get_user_role() = 'hr_support');
