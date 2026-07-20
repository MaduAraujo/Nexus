-- Permite que o colaborador veja quais tipos de documento admissional são obrigatórios,
-- para que o portal dele possa mostrar pendências reais em vez de depender só do RH avisar.
CREATE POLICY "colabo_requirements_select" ON document_requirements FOR SELECT
  USING (my_employee_id() IS NOT NULL);
