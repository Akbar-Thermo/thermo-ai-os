// ============================================================
// ai-proxy — серверная функция, через которую работает Claude
// Ключ Anthropic лежит в секретах Supabase, на фронтенд НЕ попадает.
// Деплой:
//   supabase functions deploy ai-proxy --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { content, system, model } = await req.json();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await r.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return new Response(JSON.stringify({ text, raw: data }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
