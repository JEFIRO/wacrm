// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import {
  findOrCreateChannelConversation,
  loadChannel,
} from '@/lib/whatsapp/channels';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  // Raw integrator input: the leading `+` is required so the country
  // code is explicit — "4155551212" would otherwise be delivered to
  // Switzerland, not the US (issue #586).
  const sanitized = parseInternationalPhone(phone);
  if (!sanitized) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be an international phone number with a leading + and country code (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  // Public-API sends go out through the default channel.
  const config = await loadChannel<{ id: string }>(db, accountId, null, 'id');
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: sanitized,
        name: name || sanitized,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      // Lost a race against a concurrent inbound/API create — the
      // unique index (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError(
            'db_error',
            'Failed to create contact',
            500
          );
        }
      } else {
        console.error(
          '[resolve-conversation] contact create error:',
          createErr
        );
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    } else {
      contactId = created.id;
      contactCreated = true;
    }
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook. Order oldest-first and take one row rather than
  // `.maybeSingle()`, which errors on ≥2 rows: if duplicates predate the
  // unique index (migration 036), we resolve to the canonical survivor
  // instead of falling through and creating yet another (issue #363).
  const conversationId = await findOrCreateConversationRow(
    db,
    accountId,
    contactId,
    ownerUserId,
    config.id
  );

  return { conversationId, contactId, contactCreated };
}

/**
 * Find or create the contact's conversation on the default channel —
 * shared resolution (orphan adoption, unique-index race) in
 * findOrCreateChannelConversation.
 */
async function findOrCreateConversationRow(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string,
  channelId: string
): Promise<string> {
  const resolved = await findOrCreateChannelConversation<{ id: string }>(
    db,
    { accountId, contactId, channelId, userId: ownerUserId },
    'id'
  );
  if (!resolved) {
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }
  return resolved.conversation.id;
}
