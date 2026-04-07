/**
 * Cloud-init Templates for HestiaCP Provisioning
 *
 * Generates cloud-init YAML and security hardening scripts for VPS providers
 * that support user-data (DigitalOcean, Hetzner, Vultr, Linode, etc.)
 *
 * NOTE: Providers like Clouding.io without cloud-init support use SSH-based
 * installation via installHestiaCP() instead.
 */

export interface HestiaCloudInitParams {
  hostname: string;
  email: string;
  password: string;
}

/**
 * Generates a valid cloud-init YAML script for HestiaCP installation.
 *
 * Performs:
 * 1. Hostname configuration via hostnamectl and /etc/hosts
 * 2. Downloads official HestiaCP installer
 * 3. Runs unattended installation with security optimizations:
 *    - fail2ban: disabled (NO) - masked at runtime as safety net
 *    - clamav: disabled (NO) - masked at runtime as safety net
 *    - spamassassin: disabled (NO) - masked at runtime as safety net
 *    - apache, phpfpm, exim, dovecot: enabled
 * 4. API enabled for dashboard integration
 *
 * Compatible with:
 * - DigitalOcean Droplets
 * - Hetzner Cloud
 * - Vultr
 * - Linode
 *
 * @param params - Hostname, admin email, and root password
 * @returns Valid cloud-init YAML string
 */
export function generateHestiaCloudInit(params: HestiaCloudInitParams): string {
  const { hostname, email, password } = params;

  // Escape password for shell safety: wrap in single quotes and escape any single quotes
  const escapedPassword = password.replace(/'/g, "'\\''");

  return `#cloud-config
# HestiaCP Auto-Installation via cloud-init
# Auto-generated for ${hostname}

package_update: true
package_upgrade: false

hostname: ${hostname}

write_files:
  - path: /etc/hosts
    content: |
      127.0.0.1 localhost
      ::1 localhost ip6-localhost ip6-loopback
      fe00::0 ip6-localnet
      ff00::0 ip6-mcastprefix
      ff02::1 ip6-allnodes
      ff02::2 ip6-allrouters
      127.0.1.1 ${hostname}
    append: false

runcmd:
  # Set hostname using hostnamectl
  - hostnamectl set-hostname ${hostname}

  # Download HestiaCP installer
  - wget https://raw.githubusercontent.com/hestiacp/hestiacp/release/install/hst-install.sh -O /tmp/hst-install.sh

  # Make installer executable
  - chmod +x /tmp/hst-install.sh

  # Run unattended HestiaCP installation
  # Security note: fail2ban, clamav, spamassassin disabled at install for speed
  # (security hardening masks them at runtime as a safety net)
  - |
    /tmp/hst-install.sh \\
      --hostname '${hostname}' \\
      --email '${email}' \\
      --password '${escapedPassword}' \\
      --interactive no \\
      --apache yes \\
      --phpfpm yes \\
      --exim yes \\
      --dovecot yes \\
      --clamav no \\
      --spamassassin no \\
      --fail2ban no \\
      --api yes

final_message: "HestiaCP installation started on \$HOSTNAME at \$TIMESTAMP"
`;
}

/**
 * Generates a bash script that performs full security hardening.
 *
 * This script is uploaded and executed via SSH as a single atomic operation.
 * It disables and masks three security services that were installed disabled
 * during cloud-init setup:
 *
 * 1. SpamAssassin - 3-layer kill:
 *    - Removes/overwrites config to disable mail plugins
 *    - Stops the service
 *    - Disables from autostart
 *    - Masks to prevent accidental restart
 *
 * 2. ClamAV - Kills both daemon processes:
 *    - Stops clamav-daemon (antivirus scanner)
 *    - Stops clamav-freshclam (definition updater)
 *    - Disables both from autostart
 *    - Masks both to prevent restart
 *
 * 3. Fail2ban - Removes network restrictions:
 *    - Stops the service
 *    - Disables from autostart
 *    - Masks to prevent restart
 *
 * Returns a bash script (as string) ready for SSH execution.
 */
export function generateSecurityHardenScript(): string {
  return `#!/bin/bash
set -e

echo "[*] Starting security hardening..."

# =============================================================================
# SpamAssassin - 3-layer kill
# =============================================================================
echo "[*] Hardening SpamAssassin..."

# Layer 1: Disable in mail config
if [ -f /etc/mail/spamassassin/local.cf ]; then
  cat >> /etc/mail/spamassassin/local.cf <<'EOF'

# Hardening: Disable SpamAssassin
required_score 999999
EOF
fi

# Layer 2: Stop and disable from autostart
systemctl stop spamassassin 2>/dev/null || true
systemctl disable spamassassin 2>/dev/null || true

# Layer 3: Mask to prevent accidental restart
systemctl mask spamassassin 2>/dev/null || true

echo "[+] SpamAssassin hardened"

# =============================================================================
# ClamAV - Kill both daemon processes
# =============================================================================
echo "[*] Hardening ClamAV..."

# Stop and disable clamav-daemon
systemctl stop clamav-daemon 2>/dev/null || true
systemctl disable clamav-daemon 2>/dev/null || true
systemctl mask clamav-daemon 2>/dev/null || true

# Stop and disable clamav-freshclam (definition updater)
systemctl stop clamav-freshclam 2>/dev/null || true
systemctl disable clamav-freshclam 2>/dev/null || true
systemctl mask clamav-freshclam 2>/dev/null || true

echo "[+] ClamAV hardened"

# =============================================================================
# Fail2ban - Remove network restrictions
# =============================================================================
echo "[*] Hardening Fail2ban..."

systemctl stop fail2ban 2>/dev/null || true
systemctl disable fail2ban 2>/dev/null || true
systemctl mask fail2ban 2>/dev/null || true

echo "[+] Fail2ban hardened"

# =============================================================================
# Verification
# =============================================================================
echo ""
echo "[+] Security hardening complete!"
echo ""
echo "Service status:"
systemctl is-active spamassassin 2>/dev/null || echo "   SpamAssassin: masked/stopped"
systemctl is-active clamav-daemon 2>/dev/null || echo "   ClamAV daemon: masked/stopped"
systemctl is-active clamav-freshclam 2>/dev/null || echo "   ClamAV freshclam: masked/stopped"
systemctl is-active fail2ban 2>/dev/null || echo "   Fail2ban: masked/stopped"

exit 0
`;
}
