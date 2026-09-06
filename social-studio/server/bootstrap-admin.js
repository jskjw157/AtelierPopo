export async function ensureBootstrapAdmin({ queryFn, email, passwordHash, idFactory }) {
  const existing = await queryFn('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount) return existing.rows[0].id;

  const id = idFactory();
  await queryFn(
    `INSERT INTO users (id, email, password_hash, role, status)
     VALUES ($1, $2, $3, 'owner', 'active')`,
    [id, email, passwordHash]
  );
  return id;
}
