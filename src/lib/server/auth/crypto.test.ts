import { describe, expect, test } from 'vitest';
import {
	decodeEncryptionKey,
	decryptSecret,
	encryptSecret,
	hashOpaqueToken,
	randomOpaqueToken
} from './crypto';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');

describe('authentication cryptography', () => {
	test('creates high-entropy opaque tokens and one-way lookup hashes', () => {
		const first = randomOpaqueToken();
		const second = randomOpaqueToken();

		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second).not.toBe(first);
		expect(hashOpaqueToken(first)).toMatch(/^[a-f0-9]{64}$/);
		expect(hashOpaqueToken(first)).not.toContain(first);
	});

	test('encrypts secrets with purpose-bound authenticated encryption', () => {
		const encrypted = encryptSecret('sensitive-id-token', encryptionKey, 'id-token');

		expect(encrypted).not.toContain('sensitive-id-token');
		expect(decryptSecret(encrypted, encryptionKey, 'id-token')).toBe('sensitive-id-token');
		expect(() => decryptSecret(encrypted, encryptionKey, 'pkce-verifier')).toThrow();
	});

	test('rejects malformed encryption keys and tampered ciphertext', () => {
		const encrypted = encryptSecret('secret', encryptionKey, 'id-token');
		const parts = encrypted.split('.');
		parts[3] = `${parts[3]?.startsWith('A') ? 'B' : 'A'}${parts[3]?.slice(1)}`;

		expect(() => decodeEncryptionKey('not-base64!')).toThrow(/valid base64/);
		expect(() => decodeEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
		expect(() => decryptSecret(parts.join('.'), encryptionKey, 'id-token')).toThrow();
	});
});
