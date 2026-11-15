// Шифрование данных механик (WebCrypto, AES-GCM 256 + PBKDF2-SHA256).
// Схема: у каждой страны свой случайный ключ данных (DK). Данные страны зашифрованы DK.
// DK хранится дважды: зашифрованный ключом из пароля игрока и мастер-ключом ГМа (MK).
// MK хранится зашифрованным ключом из пароля ГМа. Без паролей в репозитории видна только шифровка.
(function () {
  "use strict";
  const ITER = 150000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));

  function ready() { return !!(window.crypto && crypto.subtle); }

  async function aesKey(raw) { return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }
  async function pwKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealWith(key, bytes) {
    const iv = rnd(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function openWith(key, box) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct)));
  }

  // случайный ключ (сырые 32 байта)
  const newKey = () => rnd(32);
  // байты под паролем: { salt, iter, iv, ct }
  async function lockWithPassword(pw, bytes) {
    const salt = rnd(16);
    const box = await sealWith(await pwKey(pw, salt, ITER), bytes);
    return Object.assign({ salt: b64(salt), iter: ITER }, box);
  }
  // неверный пароль → исключение
  async function unlockWithPassword(pw, box) {
    return openWith(await pwKey(pw, unb64(box.salt), box.iter || ITER), box);
  }
  async function lockWithKey(raw, bytes) { return sealWith(await aesKey(raw), bytes); }
  async function unlockWithKey(raw, box) { return openWith(await aesKey(raw), box); }
  async function encJSON(raw, obj) { return lockWithKey(raw, enc.encode(JSON.stringify(obj))); }
  async function decJSON(raw, box) { return JSON.parse(dec.decode(await unlockWithKey(raw, box))); }
  async function encText(raw, s) { return lockWithKey(raw, enc.encode(s)); }
  async function decText(raw, box) { return dec.decode(await unlockWithKey(raw, box)); }

  // понятный пароль для игрока: 4 слова + число (64⁴ × 90 ≈ 1,5 млрд вариантов)
  const WORDS = ["ковчег", "прилив", "орбита", "пустошь", "маяк", "купол", "шторм", "рейд", "сигнал", "якорь", "гавань", "реактор", "стержень", "атолл",
    "дамба", "форпост", "зенит", "радар", "фрегат", "буря", "мираж", "кратер", "кобальт", "эхо", "полюс", "тайфун", "бастион", "гроза", "волна", "карта",
    "ледник", "пирс", "шлюз", "дрон", "лазер", "титан", "уран", "бункер", "сонар", "дюна", "риф", "каньон", "вулкан", "архипелаг", "мост", "башня",
    "сфера", "призма", "комета", "спутник", "парус", "трюм", "штиль", "отлив", "лагуна", "фьорд", "плато", "пик", "оазис", "клинок", "щит", "факел", "компас", "горизонт"];
  function genPassword() {
    const r = rnd(5);
    return [0, 1, 2, 3].map(i => WORDS[r[i] % WORDS.length]).join("-") + "-" + (10 + (r[4] % 90));
  }

  window.KGCrypto = { ready, b64, unb64, newKey, lockWithPassword, unlockWithPassword, lockWithKey, unlockWithKey, encJSON, decJSON, encText, decText, genPassword };
})();
