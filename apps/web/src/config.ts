import { MESSAGE_MAX_LENGTH, MEDIA_MAX_BYTES, PAIR_CODE_TTL_SEC } from "@crosschat/core";

export const webConfig = {
  maxFileBytes: MEDIA_MAX_BYTES,
  pairTtlSeconds: PAIR_CODE_TTL_SEC,
  messageMaxLength: MESSAGE_MAX_LENGTH,
} as const;
