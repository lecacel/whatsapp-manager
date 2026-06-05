// Script untuk memverifikasi instalasi Telegram library

console.log('\n=== Checking Telegram Library Installation ===\n');

try {
  console.log('1. Loading telegram package...');
  const telegram = require('telegram');
  console.log('   ✓ telegram package loaded');

  console.log('\n2. Checking TelegramClient...');
  const { TelegramClient } = telegram;
  console.log('   ✓ TelegramClient:', typeof TelegramClient);

  console.log('\n3. Checking StringSession...');
  const { StringSession } = require('telegram/sessions');
  console.log('   ✓ StringSession:', typeof StringSession);

  console.log('\n4. Checking NewMessage event...');
  const { NewMessage } = require('telegram/events');
  console.log('   ✓ NewMessage:', typeof NewMessage);

  console.log('\n5. Getting package version...');
  const packageInfo = require('telegram/package.json');
  console.log('   ✓ Version:', packageInfo.version);

  console.log('\n=== All checks passed! ===');
  console.log('\nTelegram integration is ready to use.\n');

} catch (error) {
  console.error('\n✗ Error detected:\n');
  console.error(error.message);
  console.error('\n=== Installation Required ===\n');
  console.error('Please run the following commands:\n');
  console.error('  cd whatsapp-manager');
  console.error('  npm install telegram@latest --save\n');
  process.exit(1);
}
