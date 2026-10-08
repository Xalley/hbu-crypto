/* HBU Crypto — ayarlar
 * Bu iki deger gizli DEGILDIR; guvenlik RLS + 2FA + sunucu tarafi kontrollerle saglanir.
 * Secret / service_role anahtarini ASLA buraya yazma.
 */
const CONFIG = Object.freeze({
  SUPABASE_URL: 'https://ezwrweshxhrutmsyvufi.supabase.co',
  PUBLIC_KEY: 'sb_publishable_sI6dswzQTcUOMEaj7pQ9tA_DmW14r6l',
  IDLE_LOGOUT_MIN: 15,
  SUPABASE_SECRETS_PAGE: 'https://supabase.com/dashboard/project/ezwrweshxhrutmsyvufi/functions/secrets',
});
