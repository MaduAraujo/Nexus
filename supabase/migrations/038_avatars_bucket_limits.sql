-- O bucket 'avatars' já existia (criado manualmente, sem limites) quando a
-- migration 033 rodou — o INSERT ... ON CONFLICT DO NOTHING preservou o
-- file_size_limit/allowed_mime_types antigos (NULL = sem limite) em vez de
-- aplicar os valores pretendidos (10MB, apenas imagens, mesmo limite já validado
-- no cliente em perfil-colaborador.js).
UPDATE storage.buckets
SET file_size_limit    = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/gif','image/webp']
WHERE id = 'avatars';
