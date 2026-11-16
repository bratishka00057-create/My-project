
const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const WEBHOOK_SECRET = "bratishka_tg_2026_secure_7f9c2a81";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("AI Bratishka bot is running!");
    }

    if (url.pathname === "/setup") {
      const result = await telegram(env, "setWebhook", {
        url: url.origin + "/webhook",
        secret_token: WEBHOOK_SECRET
      });
      return Response.json(result);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json();
      await handleUpdate(update, env);
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
};

async function telegram(env, method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  return response.json();
}

async function sendMessage(env, chatId, text) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      keyboard: [
        [{ text: "🎨 Создать изображение" }],
        [{ text: "🖼 Редактировать фото" }]
      ],
      resize_keyboard: true
    }
  });
}

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const text = message.text || message.caption || "";

  if (text === "/start") {
    return sendMessage(
      env,
      chatId,
      "Привет! Я AI Bratishka 🤖\n\n" +
      "Отправь описание изображения — я создам картинку.\n" +
      "Или отправь фотографию с подписью, что нужно изменить."
    );
  }

  if (message.photo && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];

    const file = await telegram(env, "getFile", {
      file_id: photo.file_id
    });

    if (!file.ok) {
      return sendMessage(env, chatId, "Не удалось получить фотографию 😔");
    }

    const photoResponse = await fetch(
      `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.result.file_path}`
    );

    const imageBlob = await photoResponse.blob();

    return generate(env, chatId, text || "Улучши фотографию, сохранив лицо человека и основные черты исходного изображения.", imageBlob);
  }

  if (text) {
    return generate(env, chatId, text, null);
  }
}

async function generate(env, chatId, prompt, imageBlob) {
  await sendMessage(env, chatId, "🎨 Создаю изображение. Подожди немного...");

  try {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", "1024");
    form.append("height", "1024");

    if (imageBlob) {
      form.append("input_image_0", imageBlob, "photo.jpg");
    }

    const multipart = new Response(form);

    const result = await env.AI.run(MODEL, {
      multipart: {
        body: multipart.body,
        contentType: multipart.headers.get("content-type")
      }
    });

    let image;

    if (result instanceof ReadableStream) {
      image = await new Response(result).arrayBuffer();
    } else if (result instanceof ArrayBuffer) {
      image = result;
    } else if (result && result.image) {
      image = Uint8Array.from(atob(result.image), c => c.charCodeAt(0));
    } else {
      throw new Error("Unexpected model response");
    }

    const upload = new FormData();
    upload.append("chat_id", String(chatId));
    upload.append("photo", new Blob([image], { type: "image/png" }), "result.png");
    upload.append("caption", "✨ Готово! AI Bratishka");

    const response = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: upload }
    );

    if (!response.ok) throw new Error("Telegram upload failed");

  } catch (error) {
    console.error("Image generation error:", error);
    await sendMessage(
      env,
      chatId,
      "Не получилось создать изображение 😔\nПопробуй другой запрос немного позже."
    );
  }
}
