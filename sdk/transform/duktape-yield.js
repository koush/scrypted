export default function(argument) {
  return Duktape.Thread["yield"]({
    __iter: true,
    next: {
      done: false,
      value: argument
    }
  });
}
