#ifndef COLOR_H
#define COLOR_H
#include <cmath>
#include <iomanip>
#include <random>
#include <sstream>
#include <tuple>

inline std::tuple<int, int, int> hslToRgb(float h, float s, float l) {
  float c = (1 - std::abs(2 * l - 1)) * s;
  float x = c * (1 - std::abs(std::fmod(h / 60.0f, 2) - 1));
  float m = l - c / 2;
  float r, g, b;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return {(int)((r + m) * 255), (int)((g + m) * 255), (int)((b + m) * 255)};
}

inline std::string randomColor() {
  static std::mt19937 rng(std::random_device{}());
  static std::uniform_real_distribution<float> dist(0.0f, 360.0f);

  auto [r, g, b] = hslToRgb(dist(rng), 0.7f, 0.55f);

  std::ostringstream oss;
  oss << "#" << std::hex << std::setfill('0') << std::setw(2) << r
      << std::setw(2) << g << std::setw(2) << b;
  return oss.str();
}
#endif
