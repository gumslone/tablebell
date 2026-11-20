// Host-side tests for the button gestures, retry queue and backoff. Run:
//   g++ -std=c++17 -Wall -Wextra -Wshadow -Werror -Ifirmware/table_node tests/native/test_button.cpp -o /tmp/tc_test && /tmp/tc_test
#include <cstdio>
#include <vector>
#include "button_logic.h"
using namespace tc;

static int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)

// Drive the button: hold `pressed` from t to t+ms in 1 ms steps and collect gestures.
static std::vector<Gesture> run(Button& b, uint32_t& t, bool pressed, uint32_t ms) {
  std::vector<Gesture> g;
  for (uint32_t i = 0; i < ms; i++, t++) { Gesture x = b.update(pressed, t); if (x != Gesture::None) g.push_back(x); }
  return g;
}

int main() {
  { // short press -> Call on release
    Button b; uint32_t t = 100;
    CHECK(run(b, t, true, 200).empty());
    auto g = run(b, t, false, 100);
    CHECK(g.size() == 1 && g[0] == Gesture::Call);
  }
  { // contact bounce shorter than the debounce time is ignored
    Button b; uint32_t t = 0;
    for (int i = 0; i < 5; i++) { run(b, t, true, 5); run(b, t, false, 5); }
    CHECK(run(b, t, false, 200).empty());
  }
  { // bounce while pressing still gives exactly one Call
    Button b; uint32_t t = 0;
    run(b, t, true, 8); run(b, t, false, 6); run(b, t, true, 300);
    auto g = run(b, t, false, 100);
    CHECK(g.size() == 1 && g[0] == Gesture::Call);
  }
  { // hold >= 1.5 s -> Bill while still held, no Call on release
    Button b; uint32_t t = 0;
    auto g = run(b, t, true, 1600);
    CHECK(g.size() == 1 && g[0] == Gesture::Bill);
    CHECK(b.inLongPress());
    CHECK(run(b, t, false, 200).empty());
  }
  { // keep holding to 5 s -> Cancel after the Bill
    Button b; uint32_t t = 0;
    auto g = run(b, t, true, 5200);
    CHECK(g.size() == 2 && g[0] == Gesture::Bill && g[1] == Gesture::Cancel);
    CHECK(run(b, t, false, 200).empty());
  }
  { // millis() wrap-around does not break a press
    Button b; uint32_t t = 0xFFFFFF00u;
    run(b, t, true, 300);
    auto g = run(b, t, false, 100);
    CHECK(g.size() == 1 && g[0] == Gesture::Call);
  }
  { // queue: FIFO, drops the oldest when full
    Queue<3> q;
    for (uint32_t i = 1; i <= 4; i++) q.push({i, 1});
    CHECK(q.size() == 3 && q.dropped() == 1 && q.front().id == 2);
    q.pop(); CHECK(q.front().id == 3);
    q.pop(); q.pop(); CHECK(q.empty());
    q.pop(); CHECK(q.empty());
  }
  CHECK(backoffMs(0) == 1000 && backoffMs(1) == 2000 && backoffMs(3) == 8000 && backoffMs(4) == 15000 && backoffMs(200) == 15000);
  if (fails) { printf("%d failure(s)\n", fails); return 1; }
  printf("all button tests passed\n");
  return 0;
}
