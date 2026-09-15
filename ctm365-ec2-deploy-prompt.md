# Task: Deploy the CTM365 dashboard to the new EC2 instance

You are working in the existing CTM365 Next.js project, already running locally via `npm run dev`. The goal of this task is to get this same app running continuously on a new EC2 instance, reachable over plain HTTP for now (a domain and HTTPS come later, as a separate task).

I have already, in the AWS console:
- Created an IAM role `ctm365-dashboard-ec2-role` (attached to the instance, grants DynamoDB access on `ctm365_customer_config` — same policy the local CLI user has).
- Launched an EC2 instance named `ctm365-dashboard`, Amazon Linux 2023, in `us-west-2`, with a security group allowing SSH from my IP, and HTTP/HTTPS from anywhere.
- Downloaded an SSH key pair for it.
- Allocated and associated an Elastic IP.

I'll give you the Elastic IP and the path to the downloaded `.pem` key file when I run this. If I haven't told you either of those yet, stop and ask me rather than guessing.

## Step 0: Connect and verify

The private key file needs correct permissions before Windows' SSH client will use it. Run this first, adjusting the path to wherever the key actually downloaded:
```
icacls "C:\Users\<user>\Downloads\ctm365-dashboard-key.pem" /inheritance:r
icacls "C:\Users\<user>\Downloads\ctm365-dashboard-key.pem" /grant:r "%username%:R"
```

Then confirm you can reach the instance:
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "echo connected && cat /etc/os-release"
```
If this fails, don't retry blindly — report the exact error (timeout vs. permission denied vs. connection refused mean different things) and stop. A timeout usually means the security group isn't allowing your current IP; a permission error usually means the icacls step above needs to be redone.

From here on, run remote commands the same way: `ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "<command>"`. Treat this exactly like any other command that changes shared resources — confirm each meaningful step worked before moving to the next, and report clearly rather than silently retrying with different approaches if something fails.

## Step 1: Base software

Install Node.js, git, nginx, and a swap file (the 2 GB instance can otherwise run out of memory during the build, the same way my local machine did):

```
sudo dnf update -y
sudo dnf install -y git nginx
node -v || curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v
```
Confirm Node is version 20 or newer. If the AL2023 default repo already provided a recent enough Node and `node -v` looks right before the NodeSource step, skip the NodeSource install.

Add 2 GB of swap if none exists:
```
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
```

Install pm2 globally:
```
sudo npm install -g pm2
```

## Step 2: Get the code onto the instance

The GitHub repo (`ctm365/ctm365-dashboard`) is private, so generate a read-only deploy key on the instance rather than using any personal credentials:

```
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -C "ctm365-dashboard-ec2"
cat ~/.ssh/deploy_key.pub
```

Show me that public key and stop here. I need to add it to the GitHub repo (Settings → Deploy keys → Add deploy key, read-only) before you can clone. Once I confirm it's added, continue.

Then clone using that key:
```
GIT_SSH_COMMAND="ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=accept-new" git clone git@github.com:ctm365/ctm365-dashboard.git ~/ctm365-dashboard
```

## Step 3: Environment variables

Read the local project's `.env.local` file (it's right here in this working directory) and copy its `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `COGNITO_CLIENT_SECRET` values — don't ask me to retype them, they're already sitting in the file you can read. Write them into a new file on the instance:

```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "cat > ~/ctm365-dashboard/.env.local" <<'EOF'
COGNITO_REGION=us-west-2
COGNITO_USER_POOL_ID=<value from local .env.local>
COGNITO_CLIENT_ID=<value from local .env.local>
COGNITO_CLIENT_SECRET=<value from local .env.local>
EOF
```
Use the real values, not the placeholders shown here. Don't print the secret value back to me in your report.

## Step 4: Build and run

```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "cd ~/ctm365-dashboard && npm install && npm run build"
```
If the build fails on memory even with swap, report that clearly rather than working around it with a different instance size yourself — that's my call to make.

Start it under pm2 so it stays running and restarts on crash or reboot:
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "cd ~/ctm365-dashboard && pm2 start npm --name ctm365-dashboard -- start && pm2 save"
```
Then set pm2 to launch on boot — this command prints another command you must then run with sudo:
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "pm2 startup"
```
Run whatever sudo command it prints, then `pm2 save` again.

## Step 5: nginx reverse proxy

The app is now listening on port 3000 internally. Configure nginx to forward port 80 to it:

```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "sudo tee /etc/nginx/conf.d/ctm365-dashboard.conf > /dev/null" <<'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
EOF
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx"
```

`proxy_buffering off` matters here specifically — the live dashboard streams updates over a long-lived connection (`/api/stream`), and nginx buffers responses by default, which would make it behave like it's not live.

## Step 6: Verify

From the instance itself:
```
ssh -i "<path-to-pem>" ec2-user@<elastic-ip> "curl -s -o /dev/null -w '%{http_code}' http://localhost/"
```
Expect `200` or `307` (a redirect to `/login` is correct and expected, signed out).

Then tell me to check `http://<elastic-ip>` in my own browser — you can't verify the SSE stream actually behaves as live-streaming rather than buffered from the command line alone, so this needs a real browser check.

## Final report

- Whether each step succeeded, and the exact error for anything that didn't.
- Confirm pm2 is set to restart on reboot (show the output of `pm2 status`).
- Remind me this is plain HTTP for now — no TLS yet, so browsers will show "Not secure," and that's expected until we add a domain and certificate as a separate next step.
- Any assumptions or open questions.
