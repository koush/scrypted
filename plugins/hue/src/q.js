function Deferred() {
}
  
function defer() {
  var deferred = new Deferred();
  deferred.promise = new Promise(function(resolve, reject) {
    deferred.resolve = resolve
    deferred.reject = reject
  })

  return deferred
}

var all = Promise.all;

export {
    defer,
    all,
};
