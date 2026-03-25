TARGET := main
SRC := main.cpp

ifeq ($(OS),Windows_NT)
  EXE := .exe
  LDLIBS := -lws2_32
  RM := del /Q
else
  EXE :=
  LDLIBS := -pthread
  RM := rm -f
endif

all: $(TARGET)$(EXE)

$(TARGET)$(EXE): $(SRC)
	$(CXX) $(SRC) -o $@ $(LDLIBS)

clean:
	$(RM) $(TARGET)$(EXE)

.PHONY: all clean
