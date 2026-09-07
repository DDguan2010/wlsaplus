package phonebridge

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

var errStateNotExist = errors.New("phone state does not exist")

// Native hosts keep the encryption key in DPAPI / Android Keystore.
type secureStore struct {
	mu   sync.Mutex
	dir  string
	aead cipher.AEAD
}

func newStore(dir, key string) (*secureStore, error) {
	bytes, err := hex.DecodeString(key)
	if err != nil || len(bytes) != 32 {
		return nil, errors.New("invalid storage key")
	}
	block, err := aes.NewCipher(bytes)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return &secureStore{dir: dir, aead: aead}, nil
}

func (s *secureStore) filename(id string) string {
	sum := sha256.Sum256([]byte(id))
	return filepath.Join(s.dir, hex.EncodeToString(sum[:])+".enc")
}

func (s *secureStore) ReadState(id string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.filename(id))
	if os.IsNotExist(err) {
		return nil, errStateNotExist
	}
	if err != nil {
		return nil, err
	}
	n := s.aead.NonceSize()
	if len(data) < n {
		return nil, errors.New("invalid encrypted state")
	}
	return s.aead.Open(nil, data[:n], data[n:], []byte(id))
}

func (s *secureStore) WriteState(id string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if data == nil {
		err := os.Remove(s.filename(id))
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	sealed := s.aead.Seal(nonce, nonce, data, []byte(id))
	temp, err := os.CreateTemp(s.dir, "state-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err = temp.Write(sealed); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), s.filename(id))
}
