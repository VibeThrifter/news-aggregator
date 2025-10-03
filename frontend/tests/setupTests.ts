import "@testing-library/jest-dom";

const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

afterAll(() => {
  consoleWarnSpy.mockRestore();
});
