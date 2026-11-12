"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/rbac";
import { AiError } from "@/lib/ai/client";
import { answerQuestion, buildMessages, type AskSnapshot } from "@/lib/ai/ask-core";
import type { Prisma } from "@/generated/prisma/client";

const READ_ROLES = ["ADMIN", "LOAN_OFFICER", "ACCOUNTANT", "VIEWER"];

export type ChatSummary = { id: string; title: string; updatedAt: string; messages: number };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError: boolean;
  /** ISO time it was said. */
  at: string;
  /** Lookups made for this answer (names only — the data itself loads on request). */
  lookups: string[];
};

export type AskResult =
  | { ok: true; chatId: string; question: StoredMessage; answer: StoredMessage }
  | { ok: false; error: string; chatId?: string; question?: StoredMessage };

async function staff() {
  const user = await getCurrentUser();
  return user && READ_ROLES.includes(user.role) ? user : null;
}

function lookupsOf(snapshot: unknown): string[] {
  const s = snapshot as AskSnapshot | null;
  return Array.isArray(s?.lookups) ? s.lookups.map((l) => l.tool) : [];
}

function toStored(m: {
  id: string;
  role: string;
  content: string;
  isError: boolean;
  createdAt: Date;
  snapshot: unknown;
}): StoredMessage {
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
    isError: m.isError,
    at: m.createdAt.toISOString(),
    lookups: lookupsOf(m.snapshot),
  };
}

/** Ask a question in a chat (a new chat when chatId is null). Both sides are saved with their time. */
export async function askLendo(chatId: string | null, text: string): Promise<AskResult> {
  const user = await staff();
  if (!user) return { ok: false, error: "Ask Lendo isn't available for your account." };
  const question = typeof text === "string" ? text.trim().slice(0, 4000) : "";
  if (!question) return { ok: false, error: "Type a question first." };

  // The chat's history comes from the database, never from the browser.
  let chat = chatId
    ? await db.askChat.findFirst({
        where: { id: chatId, userId: user.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (chatId && !chat) return { ok: false, error: "That chat wasn't found." };
  const past = (chat?.messages ?? [])
    .filter((m) => !m.isError)
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content, at: m.createdAt }));

  if (!chat) {
    chat = {
      ...(await db.askChat.create({
        data: { userId: user.id, title: question.replace(/\s+/g, " ").slice(0, 80) },
      })),
      messages: [],
    };
  }
  const q = await db.askMessage.create({ data: { chatId: chat.id, role: "user", content: question } });

  const now = new Date();
  let outcome;
  try {
    outcome = await answerQuestion(buildMessages(past, question, now), now);
  } catch (err) {
    const error =
      err instanceof AiError ? err.message : "Lendo AI hit an unexpected problem. Please try again.";
    if (!(err instanceof AiError)) console.error("[askLendo]", err);
    outcome = { ok: false as const, error, lookups: [] };
  }

  const a = await db.askMessage.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      content: outcome.ok ? outcome.answer : outcome.error,
      isError: !outcome.ok,
      snapshot: outcome.ok ? (outcome.snapshot as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  await db.askChat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
  await audit({
    actorId: user.id,
    action: "ai.ask",
    entity: "AskChat",
    entityId: chat.id,
    after: { question: question.slice(0, 500), lookups: outcome.lookups },
  });

  if (!outcome.ok) return { ok: false, error: outcome.error, chatId: chat.id, question: toStored(q) };
  return { ok: true, chatId: chat.id, question: toStored(q), answer: toStored(a) };
}

/** This staff member's chats, newest first. */
export async function listAskChats(): Promise<ChatSummary[]> {
  const user = await staff();
  if (!user) return [];
  const chats = await db.askChat.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  return chats.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
    messages: c._count.messages,
  }));
}

/** One chat with every message and its time. */
export async function getAskChat(
  chatId: string,
): Promise<{ id: string; title: string; messages: StoredMessage[] } | null> {
  const user = await staff();
  if (!user || typeof chatId !== "string") return null;
  const chat = await db.askChat.findFirst({
    where: { id: chatId, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!chat) return null;
  return { id: chat.id, title: chat.title, messages: chat.messages.map(toStored) };
}

/** The data an answer was based on, exactly as it was when the answer was given. */
export async function getAskSnapshot(messageId: string): Promise<AskSnapshot | null> {
  const user = await staff();
  if (!user || typeof messageId !== "string") return null;
  const m = await db.askMessage.findFirst({
    where: { id: messageId, chat: { userId: user.id } },
    select: { snapshot: true },
  });
  return (m?.snapshot as unknown as AskSnapshot) ?? null;
}

export async function deleteAskChat(chatId: string): Promise<{ ok: boolean }> {
  const user = await staff();
  if (!user || typeof chatId !== "string") return { ok: false };
  const res = await db.askChat.deleteMany({ where: { id: chatId, userId: user.id } });
  return { ok: res.count > 0 };
}
