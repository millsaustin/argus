# Certificates for Argus Reverse Proxy

For local development or sandbox environments you can generate a self-signed certificate:

```bash
mkdir -p deploy/certs
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout deploy/certs/privkey.pem \
  -out deploy/certs/fullchain.pem \
  -subj "/CN=argus.local"
```

Browsers will warn about self-signed certificates. For production, obtain trusted certificates via Let's Encrypt or another CA. Example using Certbot (running on a host with DNS pointing to this nginx instance):

```bash
sudo certbot certonly --standalone -d argus.your-domain.com
# Then copy/renew certs into deploy/certs/ and adjust nginx.conf accordingly.
```

Ensure file permissions restrict access to private keys. Reload nginx after updating certificates.
