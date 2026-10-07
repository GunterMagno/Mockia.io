import type { User as UserDTO } from '@mockia/shared';
import type { UserDocument } from '../../models/User.js';

/** Public shape of a user (never the password hash or the billing internals). */
export function toUserDTO(user: UserDocument): UserDTO {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
