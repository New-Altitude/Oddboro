import {
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify
} from 'node:crypto';
import { CompactEncrypt, compactDecrypt } from 'jose';

// The owner keeps the private half of an encryption key and the fingerprint
// of this office's signing key. The service keeps the opposite halves.
export function newPairing() {
  const owner = createECDH('prime256v1');
  owner.generateKeys();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signer = publicKey.export({ format: 'jwk' }).x;
  return {
    credential: ['ob1', owner.getPrivateKey().toString('base64url'), signer].join('.'),
    registration: {
      owner: owner.getPublicKey().toString('base64url'),
      signer: privateKey.export({ format: 'jwk' })
    }
  };
}
/** @param {Buffer} point @param {string} [scalar] */
function encryptionKey(point, scalar) {
  if (point.length !== 65 || point[0] !== 4) throw Error('Invalid owner key.');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33).toString('base64url')
  };
  return scalar
    ? createPrivateKey({ key: { ...jwk, d: scalar }, format: 'jwk' })
    : createPublicKey({ key: jwk, format: 'jwk' });
}
/** @typedef {{key:string, port:number, version:string}} Session */
/** @param {ReturnType<typeof newPairing>['registration']} registration @param {Session} session */
export async function sealSession(registration, session) {
  const recipient = encryptionKey(Buffer.from(registration.owner, 'base64url'));
  const box = await new CompactEncrypt(Buffer.from(JSON.stringify(session)))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM' })
    .encrypt(recipient);
  const signature = sign(
    null,
    Buffer.from(box),
    createPrivateKey({ key: registration.signer, format: 'jwk' })
  );
  return { box, signature: signature.toString('base64url') };
}
/** @param {string} credential @param {{box:string,signature:string}} record @returns {Promise<Session>} */
export async function openSession(credential, record) {
  const [format, scalar, signer, extra] = credential.trim().split('.');
  if (format !== 'ob1' || !scalar || !signer || extra !== undefined)
    throw Error('Enter the owner pairing code.');
  const signingKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: signer },
    format: 'jwk'
  });
  if (
    !verify(null, Buffer.from(record.box), signingKey, Buffer.from(record.signature, 'base64url'))
  )
    throw Error('This pairing code belongs to another office.');
  const owner = createECDH('prime256v1');
  owner.setPrivateKey(Buffer.from(scalar, 'base64url'));
  const key = encryptionKey(
    owner.getPublicKey(),
    Buffer.from(owner.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString(
      'base64url'
    )
  );
  const { plaintext } = await compactDecrypt(record.box, key, {
    keyManagementAlgorithms: ['ECDH-ES'],
    contentEncryptionAlgorithms: ['A256GCM']
  });
  const session = JSON.parse(Buffer.from(plaintext).toString());
  if (
    !/^[a-f0-9]{64}$/.test(session.key) ||
    !Number.isInteger(session.port) ||
    session.port < 1 ||
    session.port > 65535 ||
    typeof session.version !== 'string'
  )
    throw Error('Invalid office session.');
  return session;
}
export const nonce = () => randomBytes(32).toString('hex');

/** @param {Pick<Session,'key'|'port'>} session */
export async function verifyService({ port, key }) {
  const challenge = nonce();
  const response = await fetch(
    'http://127.0.0.1:' + port + '/api/proof?client=owner&nonce=' + challenge,
    {
      redirect: 'error',
      signal: AbortSignal.timeout(2500)
    }
  );
  if (
    !response.ok ||
    (await response.text()).trim() !==
      createHmac('sha256', key)
        .update('oddboro-proof:' + challenge)
        .digest('hex')
  )
    throw Error('The office did not prove its identity.');
}
