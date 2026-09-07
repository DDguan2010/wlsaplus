package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
	"wlsaplus/phone-network/phonebridge"
)

func main() {
	b := phonebridge.NewBridge()
	defer b.Stop()
	var output sync.Mutex
	emit := func(v any) { output.Lock(); defer output.Unlock(); json.NewEncoder(os.Stdout).Encode(v) }
	go func() {
		for range time.Tick(time.Second) {
			var s any
			json.Unmarshal([]byte(b.Status()), &s)
			emit(map[string]any{"status": s})
		}
	}()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 65536)
	for scanner.Scan() {
		var request struct {
			ID     int             `json:"id"`
			Method string          `json:"method"`
			Config json.RawMessage `json:"config"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			return
		}
		var err error
		switch request.Method {
		case "start":
			err = b.Start(string(request.Config))
		case "connect":
			err = b.Connect(string(request.Config))
		case "stop":
			b.Stop()
		case "forget":
			err = b.Forget()
		default:
			err = fmt.Errorf("unsupported command")
		}
		response := map[string]any{"id": request.ID, "status": json.RawMessage(b.Status())}
		if err != nil {
			response["error"] = err.Error()
		}
		emit(response)
	}
}
