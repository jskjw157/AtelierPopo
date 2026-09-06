import bcrypt from 'bcryptjs';

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}
console.log(await bcrypt.hash(password, 12));
