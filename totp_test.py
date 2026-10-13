import base64, hmac, hashlib, struct, time, sys
secret = sys.argv[1]
padded = secret + '=' * ((8 - len(secret) % 8) % 8)
key = base64.b32decode(padded, casefold=True)
counter = int(time.time() // 30)
msg = struct.pack('>Q', counter)
digest = hmac.new(key, msg, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
code_int = struct.unpack('>I', digest[offset:offset+4])[0] & 0x7FFFFFFF
print(str(code_int % 1000000).zfill(6))
