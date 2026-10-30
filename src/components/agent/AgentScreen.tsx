import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hand, MessageCircle, Play } from "lucide-react";
import { staffApi, useStaffRole, dateTime } from "../../lib/dine-in-client";
import { BottomSheet } from "../shared/BottomSheet";

export type Conversation = {
  chatKey: string;
  chatId: string;
  phone: string | null;
  guestName: string | null;
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  lastMessageAt: string;
  lastMessage: string | null;
  bookings: number;
};
type Message = { id: string; role: "guest" | "agent" | "system"; text: string; at: string };

export function useAgentConversations() {
  return useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => staffApi<{ conversations: Conversation[] }>("/agent/conversations"),
    refetchInterval: 15000,
  });
}
const label = (c: Conversation) => c.guestName || c.phone || c.chatId.replace(/@.*/, "");
const waLink = (c: Conversation) => {
  const digits = (c.phone ?? "").replace(/\D/g, "");
  return digits.length === 11 ? `https://wa.me/${digits}` : null;
};

/** WhatsApp dialogs handled by the Dayan agent; staff can take a chat over or give it back. */
export function AgentScreen() {
  const list = useAgentConversations();
  const [open, setOpen] = useState<Conversation | null>(null);
  const all = list.data?.conversations ?? [];
  const waiting = all.filter((c) => c.paused);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">XOXO · WhatsApp</p>
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
        <Bot size={24} /> Даян — ИИ-администратор
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Даян отвечает гостям, ставит брони и сообщает в общий чат. Если он передал чат сотруднику —
        чат сверху, ИИ в нём молчит, пока вы не вернёте его кнопкой.
      </p>
      {list.error && <p className="mt-4 text-sm text-red-700">{list.error.message}</p>}
      {waiting.length > 0 && (
        <section className="mt-5">
          <h2 className="flex items-center gap-2 font-semibold text-amber-900">
            <Hand size={18} /> Ждут сотрудника · {waiting.length}
          </h2>
          <div className="mt-2 space-y-2">
            {waiting.map((c) => (
              <Row key={c.chatKey} c={c} onOpen={() => setOpen(c)} />
            ))}
          </div>
        </section>
      )}
      <section className="mt-6">
        <h2 className="font-semibold">Все диалоги</h2>
        <div className="mt-2 space-y-2">
          {all
            .filter((c) => !c.paused)
            .map((c) => (
              <Row key={c.chatKey} c={c} onOpen={() => setOpen(c)} />
            ))}
          {list.data && !all.length && (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">
              Диалогов пока нет — они появятся, когда гости напишут в WhatsApp.
            </p>
          )}
        </div>
      </section>
      {open && (
        <ConversationSheet
          c={all.find((c) => c.chatKey === open.chatKey) ?? open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Row({ c, onOpen }: { c: Conversation; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-start gap-3 rounded-2xl p-4 text-left ring-1 ${c.paused ? "bg-amber-50 ring-amber-300" : "bg-white ring-slate-200"}`}
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-full ${c.paused ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600"}`}
      >
        {c.paused ? <Hand size={18} /> : <MessageCircle size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <strong className="truncate">{label(c)}</strong>
          <span className="shrink-0 text-xs text-slate-500">{dateTime(c.lastMessageAt)}</span>
        </span>
        {c.guestName && c.phone && <span className="block text-xs text-slate-500">{c.phone}</span>}
        {c.paused && (
          <span className="mt-0.5 block text-xs font-semibold text-amber-900">
            ИИ остановлен: {c.pausedReason ?? "нужен сотрудник"}
          </span>
        )}
        <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600">{c.lastMessage}</span>
        {c.bookings > 0 && (
          <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Броней: {c.bookings}
          </span>
        )}
      </span>
    </button>
  );
}

function ConversationSheet({ c, onClose }: { c: Conversation; onClose: () => void }) {
  const client = useQueryClient();
  const role = useStaffRole();
  const canEdit = role === "operator" || role === "manager";
  const messages = useQuery({
    queryKey: ["agent-messages", c.chatKey],
    queryFn: () =>
      staffApi<{ messages: Message[] }>(
        `/agent/conversations/messages?key=${encodeURIComponent(c.chatKey)}`,
      ),
    refetchInterval: 10000,
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      staffApi(`/agent/conversations/pause?key=${encodeURIComponent(c.chatKey)}`, {
        method: "POST",
        body: JSON.stringify({ paused }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["agent-conversations"] });
      void client.invalidateQueries({ queryKey: ["agent-messages", c.chatKey] });
    },
  });
  const wa = waLink(c);
  return (
    <BottomSheet eyebrow={c.phone ?? "WhatsApp"} title={label(c)} onClose={onClose}>
      <div className="sticky top-0 z-10 -mx-5 grid grid-cols-2 gap-2 bg-slate-50 px-5 pb-3">
        {canEdit &&
          (c.paused ? (
            <button
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-40"
              disabled={pause.isPending}
              onClick={() => pause.mutate(false)}
            >
              <Play size={16} /> Вернуть ИИ
            </button>
          ) : (
            <button
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-semibold text-white disabled:opacity-40"
              disabled={pause.isPending}
              onClick={() => pause.mutate(true)}
            >
              <Hand size={16} /> Ответить самому
            </button>
          ))}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold"
          >
            <MessageCircle size={16} /> Открыть WhatsApp
          </a>
        )}
      </div>
      {pause.error && <p className="mb-2 text-sm text-red-700">{pause.error.message}</p>}
      <div className="space-y-2 pb-2">
        {(messages.data?.messages ?? []).map((m) =>
          m.role === "system" ? (
            <p key={m.id} className="py-1 text-center text-xs text-slate-500">
              {m.text} · {dateTime(m.at)}
            </p>
          ) : (
            <div key={m.id} className={`flex ${m.role === "agent" ? "justify-end" : ""}`}>
              <p
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.role === "agent" ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md bg-white ring-1 ring-slate-200"}`}
              >
                {m.text}
                <span
                  className={`mt-1 block text-[10px] ${m.role === "agent" ? "text-slate-300" : "text-slate-400"}`}
                >
                  {m.role === "agent" ? "Даян · " : ""}
                  {dateTime(m.at)}
                </span>
              </p>
            </div>
          ),
        )}
        {messages.isPending && (
          <p className="py-6 text-center text-sm text-slate-500">Загружаем переписку…</p>
        )}
      </div>
    </BottomSheet>
  );
}
