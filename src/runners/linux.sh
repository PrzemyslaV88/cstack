#!/bin/bash
# Trusted launcher, executed ONLY inside fresh user/mount/net/PID namespaces.
# Usage: linux.sh ROOT CANDIDATE NODE_BIN RUNNER_DIR PATH COUNT READABLE... -- ARGV...
set -euo pipefail
root=$1
candidate=$2
node_bin=$3
runner_dir=$4
sandbox_path=$5
count=$6
shift 6
readable=()
for ((i = 0; i < count; i++)); do readable+=("$1"); shift; done
[ "$1" = "--" ] && shift
mount --make-rprivate /
mount -t tmpfs -o size=16m,nosuid,nodev tmpfs "$root"
mkdir -p "$root"/{usr,lib,lib64,bin,sbin,etc,dev,proc,tmp,candidate,runtime,runner}
ro_bind() {
  mount --bind "$1" "$2"
  mount -o remount,bind,ro,nosuid,nodev "$2"
}
for directory in usr lib lib64 bin sbin; do
  if [ -d "/$directory" ]; then ro_bind "/$directory" "$root/$directory"; fi
done
ro_bind "$candidate" "$root/candidate"
ro_bind "$runner_dir" "$root/runner"
touch "$root/runtime/node"
ro_bind "$node_bin" "$root/runtime/node"
# Private scratch first, so dependency binds below /tmp stay visible above it.
mount -t tmpfs -o size=128m,nosuid,nodev tmpfs "$root/tmp"
chmod 1777 "$root/tmp"
# The project's own installed dependencies and runtimes, read-only at their real paths so
# absolute links (for example a candidate's node_modules link or a venv interpreter) resolve.
for path in "${readable[@]}"; do
  mkdir -p "$root$path"
  ro_bind "$path" "$root$path"
done
for device in null zero random urandom; do
  touch "$root/dev/$device"
  mount --bind "/dev/$device" "$root/dev/$device"
done
# /proc intentionally remains empty: candidate code cannot inspect parent processes.
printf 'root:x:0:0:sandbox:/tmp:/bin/sh\n' > "$root/etc/passwd"
printf 'root:x:0:\n' > "$root/etc/group"
# Loopback names only (some tools resolve localhost at startup); the network namespace stays empty.
printf '127.0.0.1 localhost\n::1 localhost\n' > "$root/etc/hosts"
ulimit -c 0
ulimit -n 256
ulimit -f 65536
ulimit -t 120
# The host root, home directories, sockets, credentials and controller are not mounted.
# Drop namespace-root capabilities BEFORE executing any candidate code.
exec chroot "$root" /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  /usr/bin/env -i PATH="$sandbox_path" HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 TZ=UTC \
  CSTACK_CANDIDATE=/candidate CSTACK_RUNNER=/runner CSTACK_SCRATCH=/tmp \
  /bin/sh -c 'cd /candidate; exec "$@"' cstack "$@"
