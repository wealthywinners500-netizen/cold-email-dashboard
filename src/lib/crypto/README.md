# Lead integration key encryption
AES-256-GCM via node:crypto. Key derivation: HKDF of ENCRYPTION_KEY +
salt="leads-byok". See src/lib/crypto/byok.ts (Phase 3).
