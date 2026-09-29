REVOKE EXECUTE ON FUNCTION public.is_rh() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_employee_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chat_is_member(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.chat_channel_is_dm(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.medical_leaves_team() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.medical_leaves_apply_status() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_rh() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_is_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_channel_is_dm(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.medical_leaves_team() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.medical_leaves_apply_status() TO service_role;
