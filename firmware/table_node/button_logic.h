// Pure logic (no Arduino calls) so it can be unit-tested on the host.
#pragma once
#include <stdint.h>

namespace tc {

// Debounced button with three gestures:
//   short press (released before LONG_MS)         -> Call   (on release)
//   hold LONG_MS..CANCEL_MS, then release         -> Bill   (on release)
//   keep holding until CANCEL_MS                  -> Cancel (fires while held; no Bill is sent)
// Bill fires on release so that holding on to cancel never raises a bill alarm for the waiters.
// longReached() tells the caller when to give "you are in bill territory" feedback (beep/LED).
enum class Gesture : uint8_t { None, Call, Bill, Cancel };

struct ButtonCfg {
  uint16_t debounceMs = 30;
  uint16_t longMs = 1500;
  uint16_t cancelMs = 5000;
};

class Button {
 public:
  explicit Button(ButtonCfg c = ButtonCfg()) : cfg_(c) {}

  // Call often with the raw pin state (true = pressed) and millis().
  Gesture update(bool rawPressed, uint32_t now) {
    now_ = now;
    if (rawPressed != raw_) { raw_ = rawPressed; rawSince_ = now; }
    if ((uint32_t)(now - rawSince_) >= cfg_.debounceMs && stable_ != raw_) {
      stable_ = raw_;
      if (stable_) { downAt_ = now; sentCancel_ = false; }
      else if (!sentCancel_) {
        return (uint32_t)(now - downAt_) >= cfg_.longMs ? Gesture::Bill : Gesture::Call;
      }
    }
    if (stable_ && !sentCancel_ && (uint32_t)(now - downAt_) >= cfg_.cancelMs) {
      sentCancel_ = true;
      return Gesture::Cancel;
    }
    return Gesture::None;
  }

  bool pressed() const { return stable_; }
  // Held long enough that releasing now sends Bill (false once Cancel has fired).
  bool longReached() const { return stable_ && !sentCancel_ && (uint32_t)(now_ - downAt_) >= cfg_.longMs; }

 private:
  ButtonCfg cfg_;
  bool raw_ = false, stable_ = false, sentCancel_ = false;
  uint32_t rawSince_ = 0, downAt_ = 0, now_ = 0;
};

// Retry queue for events that must not get lost while Wi-Fi or the hub is down.
// Fixed size, no heap. When full, the oldest event is dropped (a newer call supersedes it anyway).
struct Event { uint32_t id; uint8_t type; };  // type: 1 call, 2 bill, 3 cancel

template <uint8_t N>
class Queue {
 public:
  bool empty() const { return n_ == 0; }
  uint8_t size() const { return n_; }
  void push(Event e) {
    if (n_ == N) { head_ = (head_ + 1) % N; n_--; dropped_++; }
    buf_[(head_ + n_) % N] = e; n_++;
  }
  const Event& front() const { return buf_[head_]; }
  void pop() { if (n_) { head_ = (head_ + 1) % N; n_--; } }
  uint16_t dropped() const { return dropped_; }
 private:
  Event buf_[N];
  uint8_t head_ = 0, n_ = 0;
  uint16_t dropped_ = 0;
};

// Retry delay: 1 s, 2 s, 4 s ... capped at 15 s.
inline uint32_t backoffMs(uint8_t failures) {
  uint32_t d = 1000UL << (failures > 4 ? 4 : failures);
  return d > 15000UL ? 15000UL : d;
}

}  // namespace tc
