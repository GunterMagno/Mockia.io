import type { User as UserDTO } from '@mockia/shared';
import type { UserDocument } from '../../models/User.js';

type StoredConsent = NonNullable<UserDocument['aiTrainingConsent']>;
const isoOrNull = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/**
 * Public shape of the AI training consent. `at` = when the current choice was made; `grantedAt` / `withdrawnAt` keep
 * both moments (a legacy granted row has only `at`, which is its grant time).
 */
export function consentDTO(c: StoredConsent): { granted: boolean; at: string; grantedAt: string | null; withdrawnAt: string | null } {
  return {
    granted: c.granted,
    at: new Date(c.at).toISOString(),
    grantedAt: isoOrNull(c.grantedAt ?? (c.granted ? c.at : null)),
    withdrawnAt: isoOrNull(c.withdrawnAt),
  };
}

/** Public shape of a user (never the password hash or the billing internals). */
export function toUserDTO(user: UserDocument): UserDTO {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    ...(user.locale ? { locale: user.locale } : {}),
    ...(user.aiTrainingConsent ? { aiTrainingConsent: consentDTO(user.aiTrainingConsent) } : {}),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
