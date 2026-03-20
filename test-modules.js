try {
  require('puppeteer-extra');
  console.log('puppeteer-extra OK');
} catch(e) {
  console.log('puppeteer-extra FAILED:', e.message);
}

try {
  require('puppeteer-extra-plugin-stealth');
  console.log('puppeteer-extra-plugin-stealth OK');
} catch(e) {
  console.log('puppeteer-extra-plugin-stealth FAILED:', e.message);
}

try {
  require('puppeteer-core');
  console.log('puppeteer-core OK');
} catch(e) {
  console.log('puppeteer-core FAILED:', e.message);
}
