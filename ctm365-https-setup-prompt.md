# Task: Add HTTPS to the CTM365 dashboard on EC2

The dashboard is already deployed and running on the EC2 instance under pm2, behind nginx on port 80, at `dashboard.ctm365.com` (DNS confirmed resolving to the Elastic IP). This task adds a real TLS certificate so it serves over `https://`, with plain `http://` redirecting to it automatically.

Connect the same way as the earlier deploy task: `ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "<command>"`. If I haven't given you the IP and key path in this session, ask rather than guessing. Treat every command that installs software or changes nginx/pm2 the same as before — confirm each step worked before moving to the next, and report plainly rather than retrying blindly if something fails.

## Step 1: Point the existing nginx config at the real hostname

The current config at `/etc/nginx/conf.d/ctm365-dashboard.conf` has `server_name _;` (a catch-all). Certbot needs it to match the real domain to edit it correctly:

```
sudo sed -i 's/server_name _;/server_name dashboard.ctm365.com;/' /etc/nginx/conf.d/ctm365-dashboard.conf
sudo nginx -t && sudo systemctl reload nginx
```

## Step 2: Install certbot

Amazon Linux 2023 doesn't have a native certbot package and doesn't support snap, so use the pip/venv method:

```
sudo dnf install -y python3 augeas-libs cronie
sudo systemctl enable --now crond
sudo python3 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install certbot certbot-nginx
sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
certbot --version
```

## Step 3: Get the certificate

```
sudo certbot --nginx -d dashboard.ctm365.com --non-interactive --agree-tos -m chris@ctm365.com --redirect
```

This should obtain the certificate via an HTTP challenge on port 80 (already open), add a `listen 443 ssl;` block to the matching server, and turn the port 80 block into a redirect to https.

After it runs:
```
sudo nginx -t
```
Then **check the resulting config carefully**, don't just assume it worked cleanly: `cat /etc/nginx/conf.d/ctm365-dashboard.conf`. Confirm the new port 443 server block still has `proxy_buffering off;`, `proxy_buffer_size 16k;`, `proxy_buffers 4 16k;`, and `proxy_busy_buffers_size 32k;` in its `location /` block — these were added earlier specifically because the live data stream needs them, and if certbot's edit dropped or didn't carry them into the new block, add them back manually before moving on.

## Step 4: Set up automatic renewal

The pip-installed certbot doesn't come with a renewal timer the way an OS package would, so add one:

```
echo '0 3 * * * root /opt/certbot/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"' | sudo tee /etc/cron.d/certbot-renew
```

Then confirm the renewal process itself actually works, without waiting for the real 90-day expiry:
```
sudo /opt/certbot/bin/certbot renew --dry-run
```
Report whether this succeeded.

## Step 5: Turn secure cookies back on

Now that there's a real certificate, the earlier plain-HTTP workaround should be removed:

```
sed -i '/^COOKIE_SECURE=false$/d' ~/ctm365-dashboard/.env.local
pm2 restart ctm365-dashboard
```
Don't print the file's contents in your report — it still holds the Cognito client secret.

## Step 6: Verify

From the server itself:
```
curl -sI https://dashboard.ctm365.com/
curl -sI http://dashboard.ctm365.com/
```
Expect the https request to succeed (likely a redirect to /login), and the plain http request to now come back as a redirect to the https version, rather than serving the app directly.

Then tell me to check in my own browser: `https://dashboard.ctm365.com`, confirming the padlock shows with no warning, and that I can actually sign in and land on the dashboard — that's the real test that secure cookies work correctly again now that TLS is genuinely in place.

## Final report

- What changed, and the certificate's expiry date.
- Confirmation the dry-run renewal succeeded.
- Remind me that the WordPress menu link still points at `http://dashboard.ctm365.com` and needs updating to `https://`.
- Any assumptions (including the email address used for Let's Encrypt's own renewal-warning notices) or open questions.
