import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER_VERSION = 'v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const TOKEN_BYTES = 32;

export type EncryptionPurpose = 'id-token' | 'pkce-verifier';

export function randomOpaqueToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function decodeEncryptionKey(encodedKey: string): Buffer {
	const normalized = encodedKey.replaceAll('-', '+').replaceAll('_', '/');
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
		throw new Error('OIDC_DATA_ENCRYPTION_KEY must be valid base64');
	}

	const key = Buffer.from(normalized, 'base64');
	const canonical = key.toString('base64').replace(/=+$/, '');
	if (canonical !== normalized.replace(/=+$/, '') || key.length !== KEY_LENGTH) {
		throw new Error('OIDC_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes');
	}
	return key;
}

export function encryptSecret(
	plaintext: string,
	encodedKey: string,
	purpose: EncryptionPurpose
): string {
	if (!plaintext) throw new Error('Cannot encrypt an empty secret');

	const key = decodeEncryptionKey(encodedKey);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(purpose, 'utf8'));
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return [
		CIPHER_VERSION,
		iv.toString('base64url'),
		tag.toString('base64url'),
		ciphertext.toString('base64url')
	].join('.');
}

export function decryptSecret(
	envelope: string,
	encodedKey: string,
	purpose: EncryptionPurpose
): string {
	const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split('.');
	if (
		version !== CIPHER_VERSION ||
		!encodedIv ||
		!encodedTag ||
		!encodedCiphertext ||
		extra !== undefined
	) {
		throw new Error('Encrypted secret has an invalid envelope');
	}

	const iv = Buffer.from(encodedIv, 'base64url');
	const tag = Buffer.from(encodedTag, 'base64url');
	if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
		throw new Error('Encrypted secret has invalid parameters');
	}

	const decipher = createDecipheriv('aes-256-gcm', decodeEncryptionKey(encodedKey), iv);
	decipher.setAAD(Buffer.from(purpose, 'utf8'));
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
		decipher.final()
	]).toString('utf8');
}
