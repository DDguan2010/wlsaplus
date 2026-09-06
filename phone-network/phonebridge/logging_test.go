package phonebridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tailscale.com/envknob"
	"tailscale.com/logpolicy"
)

func TestLogsUseAppStorageWithoutSystemDirectories(t *testing.T) {
	t.Setenv("TS_LOGS_DIR", "")
	t.Setenv("TS_NO_LOGS_NO_SUPPORT", "")
	dir := filepath.Join(t.TempDir(), "state")
	for range 2 {
		if err := configureLogs(dir); err != nil {
			t.Fatal(err)
		}
		// Call the exact upstream path that panicked on Android. It must never
		// consult the host's home or temporary directory.
		got := logpolicy.LogsDir(func(string, ...any) { t.Fatal("used fallback log directory") })
		if got != filepath.Join(dir, "logs") {
			t.Fatalf("unexpected log directory: %s", got)
		}
		entries, err := os.ReadDir(got)
		if err != nil || len(entries) != 0 {
			t.Fatalf("storage check left files behind: %v, %v", entries, err)
		}
		if !envknob.NoLogsNoSupport() {
			t.Fatal("diagnostic uploads enabled")
		}
	}
}

func TestStartRejectsInvalidLogStorageBeforeStartingTailscale(t *testing.T) {
	t.Setenv("TS_LOGS_DIR", "unchanged")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "logs"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(config{Role: "phone", Dir: dir, Hostname: "startup-test", StorageKey: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	b := NewBridge()
	if err := b.Start(string(raw)); err == nil || !strings.Contains(err.Error(), "log directory") {
		t.Fatalf("expected storage error, got %v", err)
	}
	if b.s != nil || os.Getenv("TS_LOGS_DIR") != "unchanged" {
		t.Fatal("invalid storage started Tailscale or changed its configuration")
	}
}
