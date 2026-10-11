import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "id";

const en = {
  "common.cancel": "Cancel",
  "common.retry": "Retry",
  "common.close": "Close",
  "common.minutes": "{n} minutes",
  "common.copyFailedSelect": "Copy failed. Select the code manually.",
  "common.copyFailedManual": "Copy failed. Copy the code manually.",
  "common.closeDialog": "close",

  "landing.signIn": "Sign in",
  "landing.signInGoogle": "Sign in with Google",
  "landing.howLinking": "How linking works",
  "landing.supported": "Supported platforms",
  "landing.eyebrow": "Private 1:1 bridge",
  "landing.heroTitle": "Chat across platforms",
  "landing.heroSub":
    "CrossChat connects you with people on other platforms without requiring you to use their apps. Pair once, then chat from your browser.",
  "landing.limitCode": "{n}-minute code",
  "landing.limitRoom": "Private 1:1 room",
  "landing.limitMedia": "Media up to {limit}",
  "landing.step1t": "Sign in",
  "landing.step1x": "Sign in with Google on the web to get your private room.",
  "landing.step2t": "Get a code",
  "landing.step2x": "Generate a one-time code. It expires in {ttl}.",
  "landing.step3t": "Link a platform",
  "landing.step3x": "Send it to the bot, or enter the bot's code on the web.",
  "landing.sample": "AB12-CD34 → Linked. Say hi from either side.",
  "landing.oss": "Open source (MIT).",
  "landing.source": "Source code",

  "chat.disconnectConfirm": "Disconnect this chat? You can pair again any time.",
  "chat.pair1t": "Generate a code",
  "chat.pair1x": "Create one in the Platforms panel. It lasts {ttl}.",
  "chat.pair2t": "Send it to the bot",
  "chat.pair2x": "Pick a platform to see its linking steps.",
  "chat.pair3t": "Start chatting",
  "chat.pair3x": "Messages sync both ways from here.",
  "chat.loadFailed": "Could not load the conversation. Check your connection and try again.",
  "chat.loadTitle": "Couldn’t load the conversation",
  "chat.platformMissed": "Saved here, but the platform did not receive it. Check the bot connection, then resend.",
  "chat.genFailed": "Could not create a code. Try again.",
  "chat.claimShort": "That code looks short. It should look like {ex}.",
  "chat.claimFailed": "That code is invalid or expired.",
  "chat.fileTooBig": "Files are limited to {limit}. Pick a smaller file.",
  "chat.fileFailed": "File failed to send. Try again.",
  "chat.deleteFailed": "Could not delete that message. Try again.",
  "chat.disconnectFailed": "Could not disconnect. Try again.",
  "chat.openPanel": "Open pairing panel",
  "chat.noPlatform": "No platform linked",
  "chat.connected": "Connected",
  "chat.notConnected": "Not connected",
  "chat.disconnect": "Disconnect",
  "chat.howToConnect": "How to connect {label}",
  "chat.offline": "Connection lost. Reconnecting…",
  "chat.emptyTitle": "Link a platform to start chatting",
  "chat.emptySub": "Generate a one-time code, send it to your platform's bot, then chat from either side.",
  "chat.emptyDesktop": "Use the Platforms panel on the left to generate your code.",
  "chat.drawerTitle": "Pairing",
  "chat.drawerClose": "Close pairing panel",

  "panel.linkedIs": "{label} linked",
  "panel.linked": "Linked",
  "profile.title": "Profile",
  "panel.noLink": "No platform linked",
  "panel.signOut": "Sign out",
  "panel.platforms": "Platforms",
  "panel.platformsSub": "Pick a platform to see how to link it. One room at a time.",
  "panel.pairTitle": "Pair your account",
  "panel.pairSub": "Generate a code and send it to your platform, or enter one it gave you. Valid {ttl}.",
  "panel.expiresIn": "Expires in {left}",
  "panel.copied": "Copied",
  "panel.copy": "Copy",
  "panel.linkCopied": "Link copied",
  "panel.copyLink": "Copy link",
  "panel.newCode": "New code",
  "panel.waiting": "Waiting for your platform…",
  "panel.generate": "Generate code",
  "panel.creating": "Creating…",
  "panel.enterCode": "Enter code",
  "panel.switch": "Switch platform",
  "panel.roomOne": "{count} message in this room.",
  "panel.roomMany": "{count} messages in this room.",
  "panel.account": "Account",
  "panel.userId": "User ID",
  "panel.since": "Since",
  "panel.total": "Total",
  "panel.fromWeb": "From web",
  "panel.fromPlatform": "From {label}",
  "panel.lastActivity": "Last activity",
  "panel.deleteHint": "Right-click or long-press one of your messages to delete it on both sides.",
  "panel.syncNote": "Text, photos, video, documents and voice notes up to {limit} sync both ways.",

  "claim.title": "Enter pairing code",
  "claim.sub": "It looks like {ex}. Codes are valid for {ttl}.",
  "claim.checking": "Checking…",
  "claim.connect": "Connect",
  "claim.label": "Pairing code",

  "delete.aria": "Delete message",
  "delete.title": "Delete this message?",
  "delete.body": "It will be removed here and on your linked platform, including its file if it has one.",
  "delete.deleting": "Deleting…",
  "delete.delete": "Delete",
  "delete.kindPhoto": "photo",
  "delete.kindVideo": "video",
  "delete.kindVoice": "voice note",
  "delete.kindSticker": "sticker",
  "delete.kindDoc": "document",
  "delete.attachment": "({kind} attachment)",

  "tips.aria": "Link a platform",
  "tips.linkTitle": "Link {label}",
  "tips.linkedIs": "{label} is linked. Show linking steps.",
  "tips.linkCta": "Link {label}. Show linking steps.",

  "composer.attach": "Attach a file",
  "composer.attachMax": "Attach a file (max {limit})",
  "composer.uploading": "Uploading file",
  "composer.cancelUpload": "Cancel upload",
  "composer.writePh": "Write a message…",
  "composer.writeLabel": "Write a message",
  "composer.send": "Send message",
  "composer.sendTitle": "Send",
  "composer.hint": "Media up to {limit} · Enter to send · Right-click or long-press your message to delete it",

  "push.enable": "Enable new-message notifications",
  "push.disable": "Disable new-message notifications",
  "push.onTitle": "New-message notifications on",
  "push.offTitle": "Notify me about new messages",
  "push.blocked": "Notifications are blocked in the browser settings",

  "list.aria": "Messages",
  "list.empty": "No messages yet",
  "list.emptySub": "Send the first message from here or your platform. It appears on both sides.",
  "list.today": "Today",
  "list.yesterday": "Yesterday",

  "bubble.you": "You",
  "bubble.photoMsg": "Photo message",
  "bubble.photo": "Photo",
  "bubble.sticker": "Sticker",
  "bubble.openDoc": "Open document",
  "bubble.retry": "Not delivered, tap to retry",
  "bubble.retryAria": "Retry sending message {id}: {text}",

  "notfound.title": "Page not found",
  "notfound.sub": "Try the landing or your chat room.",
  "notfound.home": "Home",
  "notfound.openChat": "Open chat",

  "lang.switch": "Switch language",

  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.light": "Light",
  "settings.dark": "Dark",
  "settings.language": "Language",
  "settings.english": "English",
  "settings.indonesian": "Indonesia",

  "anon.title": "Anonymous chat",
  "anon.sub": "Get matched with a random stranger across any platform.",
  "anon.find": "Find a partner",
  "anon.searching": "Searching for a partner…",
  "anon.cancel": "Cancel search",
  "anon.session": "Session {id}",
  "anon.partner": "Chatting with {partner}",
  "anon.next": "Next partner",
  "anon.stop": "Stop",
  "anon.ended": "Your partner left. Find a new one?",
  "anon.stopped": "Anonymous chat ended.",
  "anon.hint": "Be kind. No history is saved after you leave.",
  "anon.sendFailed": "Message failed to send. Try again.",
  "anon.sessionGone": "Session ended. Find a new partner to keep chatting.",
} as const;

type Key = keyof typeof en;

const id: Record<Key, string> = {
  "common.cancel": "Batal",
  "common.retry": "Coba lagi",
  "common.close": "Tutup",
  "common.minutes": "{n} menit",
  "common.copyFailedSelect": "Gagal menyalin. Pilih kodenya secara manual.",
  "common.copyFailedManual": "Gagal menyalin. Salin kodenya secara manual.",
  "common.closeDialog": "tutup",

  "landing.signIn": "Masuk",
  "landing.signInGoogle": "Masuk dengan Google",
  "landing.howLinking": "Cara menghubungkan",
  "landing.supported": "Platform yang didukung",
  "landing.eyebrow": "Jembatan 1:1 privat",
  "landing.heroTitle": "Ngobrol lintas platform",
  "landing.heroSub":
    "CrossChat menghubungkan Anda dengan orang di platform lain tanpa harus memakai aplikasi mereka. Tautkan sekali, lalu ngobrol dari browser.",
  "landing.limitCode": "Kode {n} menit",
  "landing.limitRoom": "Room 1:1 privat",
  "landing.limitMedia": "Media hingga {limit}",
  "landing.step1t": "Masuk",
  "landing.step1x": "Masuk dengan Google di web untuk mendapatkan room privat.",
  "landing.step2t": "Dapatkan kode",
  "landing.step2x": "Buat kode sekali pakai. Berlaku {ttl}.",
  "landing.step3t": "Tautkan platform",
  "landing.step3x": "Kirim ke bot, atau masukkan kode dari bot di web.",
  "landing.sample": "AB12-CD34 → Tertaut. Sapa dari sisi mana pun.",
  "landing.oss": "Sumber terbuka (MIT).",
  "landing.source": "Kode sumber",

  "chat.disconnectConfirm": "Putuskan chat ini? Anda bisa menautkan lagi kapan saja.",
  "chat.pair1t": "Buat kode",
  "chat.pair1x": "Buat di panel Platforms. Berlaku {ttl}.",
  "chat.pair2t": "Kirim ke bot",
  "chat.pair2x": "Pilih platform untuk melihat langkahnya.",
  "chat.pair3t": "Mulai ngobrol",
  "chat.pair3x": "Pesan tersinkron dua arah dari sini.",
  "chat.loadFailed": "Gagal memuat percakapan. Periksa koneksi lalu coba lagi.",
  "chat.loadTitle": "Percakapan gagal dimuat",
  "chat.platformMissed": "Tersimpan di sini, tapi platform tidak menerimanya. Periksa koneksi bot, lalu kirim ulang.",
  "chat.genFailed": "Gagal membuat kode. Coba lagi.",
  "chat.claimShort": "Kode itu terlihat pendek. Seharusnya seperti {ex}.",
  "chat.claimFailed": "Kode tidak valid atau kedaluwarsa.",
  "chat.fileTooBig": "File dibatasi {limit}. Pilih file yang lebih kecil.",
  "chat.fileFailed": "File gagal terkirim. Coba lagi.",
  "chat.deleteFailed": "Gagal menghapus pesan. Coba lagi.",
  "chat.disconnectFailed": "Gagal memutuskan. Coba lagi.",
  "chat.openPanel": "Buka panel penautan",
  "chat.noPlatform": "Belum ada platform tertaut",
  "chat.connected": "Terhubung",
  "chat.notConnected": "Tidak terhubung",
  "chat.disconnect": "Putuskan",
  "chat.howToConnect": "Cara menghubungkan {label}",
  "chat.offline": "Koneksi terputus. Menyambung ulang…",
  "chat.emptyTitle": "Tautkan platform untuk mulai ngobrol",
  "chat.emptySub": "Buat kode sekali pakai, kirim ke bot platform Anda, lalu ngobrol dari sisi mana pun.",
  "chat.emptyDesktop": "Gunakan panel Platforms di kiri untuk membuat kode.",
  "chat.drawerTitle": "Penautan",
  "chat.drawerClose": "Tutup panel penautan",

  "panel.linkedIs": "{label} tertaut",
  "panel.linked": "Tertaut",
  "profile.title": "Profil",
  "panel.noLink": "Belum ada platform tertaut",
  "panel.signOut": "Keluar",
  "panel.platforms": "Platform",
  "panel.platformsSub": "Pilih platform untuk melihat cara menautkannya. Satu room dalam satu waktu.",
  "panel.pairTitle": "Tautkan akun Anda",
  "panel.pairSub": "Buat kode dan kirim ke platform Anda, atau masukkan kode darinya. Berlaku {ttl}.",
  "panel.expiresIn": "Berlaku {left}",
  "panel.copied": "Tersalin",
  "panel.copy": "Salin",
  "panel.linkCopied": "Tautan tersalin",
  "panel.copyLink": "Salin tautan",
  "panel.newCode": "Kode baru",
  "panel.waiting": "Menunggu platform Anda…",
  "panel.generate": "Buat kode",
  "panel.creating": "Membuat…",
  "panel.enterCode": "Masukkan kode",
  "panel.switch": "Ganti platform",
  "panel.roomOne": "{count} pesan di room ini.",
  "panel.roomMany": "{count} pesan di room ini.",
  "panel.account": "Akun",
  "panel.userId": "ID Pengguna",
  "panel.since": "Sejak",
  "panel.total": "Total",
  "panel.fromWeb": "Dari web",
  "panel.fromPlatform": "Dari {label}",
  "panel.lastActivity": "Aktivitas terakhir",
  "panel.deleteHint": "Klik kanan atau tahan salah satu pesan Anda untuk menghapusnya di kedua sisi.",
  "panel.syncNote": "Teks, foto, video, dokumen, dan pesan suara hingga {limit} tersinkron dua arah.",

  "claim.title": "Masukkan kode penautan",
  "claim.sub": "Bentuknya seperti {ex}. Kode berlaku {ttl}.",
  "claim.checking": "Memeriksa…",
  "claim.connect": "Hubungkan",
  "claim.label": "Kode penautan",

  "delete.aria": "Hapus pesan",
  "delete.title": "Hapus pesan ini?",
  "delete.body": "Pesan akan dihapus di sini dan di platform tertaut, termasuk filenya jika ada.",
  "delete.deleting": "Menghapus…",
  "delete.delete": "Hapus",
  "delete.kindPhoto": "foto",
  "delete.kindVideo": "video",
  "delete.kindVoice": "pesan suara",
  "delete.kindSticker": "stiker",
  "delete.kindDoc": "dokumen",
  "delete.attachment": "(lampiran {kind})",

  "tips.aria": "Tautkan platform",
  "tips.linkTitle": "Tautkan {label}",
  "tips.linkedIs": "{label} sudah tertaut. Tampilkan langkah.",
  "tips.linkCta": "Tautkan {label}. Tampilkan langkah.",

  "composer.attach": "Lampirkan file",
  "composer.attachMax": "Lampirkan file (maks {limit})",
  "composer.uploading": "Mengunggah file",
  "composer.cancelUpload": "Batalkan unggahan",
  "composer.writePh": "Tulis pesan…",
  "composer.writeLabel": "Tulis pesan",
  "composer.send": "Kirim pesan",
  "composer.sendTitle": "Kirim",
  "composer.hint": "Media hingga {limit} · Enter untuk kirim · Klik kanan atau tahan pesan Anda untuk menghapusnya",

  "push.enable": "Aktifkan notifikasi pesan baru",
  "push.disable": "Matikan notifikasi pesan baru",
  "push.onTitle": "Notifikasi pesan baru aktif",
  "push.offTitle": "Beri tahu saya tentang pesan baru",
  "push.blocked": "Notifikasi diblokir di pengaturan browser",

  "list.aria": "Pesan",
  "list.empty": "Belum ada pesan",
  "list.emptySub": "Kirim pesan pertama dari sini atau platform Anda. Muncul di kedua sisi.",
  "list.today": "Hari ini",
  "list.yesterday": "Kemarin",

  "bubble.you": "Anda",
  "bubble.photoMsg": "Pesan foto",
  "bubble.photo": "Foto",
  "bubble.sticker": "Stiker",
  "bubble.openDoc": "Buka dokumen",
  "bubble.retry": "Tidak terkirim, ketuk untuk coba lagi",
  "bubble.retryAria": "Coba kirim ulang pesan {id}: {text}",

  "notfound.title": "Halaman tidak ditemukan",
  "notfound.sub": "Coba halaman utama atau room chat Anda.",
  "notfound.home": "Beranda",
  "notfound.openChat": "Buka chat",

  "lang.switch": "Ganti bahasa",

  "settings.title": "Pengaturan",
  "settings.theme": "Tema",
  "settings.light": "Terang",
  "settings.dark": "Gelap",
  "settings.language": "Bahasa",
  "settings.english": "English",
  "settings.indonesian": "Indonesia",

  "anon.title": "Ngobrol anonim",
  "anon.sub": "Dipertemukan dengan orang asing acak dari platform mana pun.",
  "anon.find": "Cari pasangan",
  "anon.searching": "Mencari pasangan…",
  "anon.cancel": "Batalkan pencarian",
  "anon.session": "Sesi {id}",
  "anon.partner": "Ngobrol dengan {partner}",
  "anon.next": "Pasangan baru",
  "anon.stop": "Berhenti",
  "anon.ended": "Pasangan Anda pergi. Cari yang baru?",
  "anon.stopped": "Ngobrol anonim berakhir.",
  "anon.hint": "Bersikap baik. Tidak ada riwayat yang disimpan setelah Anda pergi.",
  "anon.sendFailed": "Pesan gagal terkirim. Coba lagi.",
  "anon.sessionGone": "Sesi berakhir. Cari pasangan baru untuk lanjut ngobrol.",
};

const dicts: Record<Lang, Record<Key, string>> = { en, id };

export type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

function makeT(lang: Lang): T {
  return (key, vars) => {
    let s = dicts[lang][key];
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    }
    return s;
  };
}

const STORAGE_KEY = "crosschat:lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "id") return saved;
    if (navigator.language?.toLowerCase().startsWith("id")) return "id";
  } catch {
    // Private mode: fall through to English.
  }
  return "en";
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
}

const fallback: LangCtx = { lang: "en", setLang: () => {}, t: makeT("en") };

const Ctx = createContext<LangCtx>(fallback);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  useEffect(() => {
    document.documentElement.lang = lang === "id" ? "id" : "en";
  }, [lang]);

  function setLang(l: Lang): void {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Private mode: language just doesn't persist.
    }
  }

  const ctx: LangCtx = { lang, setLang, t: makeT(lang) };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}

export function LangToggle() {
  const { lang, setLang, t } = useLang();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm px-2 font-mono text-xs"
      onClick={() => setLang(lang === "en" ? "id" : "en")}
      aria-label={t("lang.switch")}
      title={t("lang.switch")}
    >
      {lang === "en" ? "ID" : "EN"}
    </button>
  );
}
