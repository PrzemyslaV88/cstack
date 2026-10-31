#!/bin/bash
# Trusted launcher, executed ONLY inside fresh user/mount/net/PID namespaces.
set -euo pipefail
root=$1
candidate=$2
node_bin=$3
runner_dir=$4
shift 4
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
for device in null zero random urandom; do
  touch "$root/dev/$device"
  mount --bind "/dev/$device" "$root/dev/$device"
done
# /proc intentionally remains empty: candidate code cannot inspect parent processes.
mount -t tmpfs -o size=128m,nosuid,nodev tmpfs "$root/tmp"
chmod 1777 "$root/tmp"
printf 'root:x:0:0:sandbox:/tmp:/bin/sh\n' > "$root/etc/passwd"
printf 'root:x:0:\n' > "$root/etc/group"
ulimit -c 0
ulimit -n 256
ulimit -f 65536
ulimit -t 120
# The host root, sockets, credentials and controller are not mounted.
# Drop namespace-root capabilities BEFORE executing any candidate code.
exec chroot "$root" /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  /usr/bin/env -i PATH=/runtime:/usr/local/bin:/usr/bin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 TZ=UTC \
  /bin/sh -c 'cd /candidate; exec "$@"' cstack "$@"
