self.addEventListener("push", (event) => {
  // Payload-less push: the ping itself is the signal, no content travels.
  event.waitUntil(
    self.registration.showNotification("Crosschat", {
      body: "You have new messages.",
      data: { url: "/chat" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/chat";
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const chat = wins.find((w) => {
        try {
          return new URL(w.url).pathname.startsWith("/chat");
        } catch {
          return false;
        }
      });
      if (chat) return chat.focus();
      if (wins.length > 0) {
        const first = wins[0];
        await first.focus();
        return first.navigate(url);
      }
      return clients.openWindow(url);
    })(),
  );
});
