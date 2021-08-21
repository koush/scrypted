const template = require("babel-template");

function wrapDuktapeThread (argument) {
  const build = template(`
    var thread = new Duktape.Thread(YIELDER.bind(this));
    var iterDone;
    var doneValue;

    function finish(lastValue) {
      doneValue = lastValue;
      iterDone = true;
    }

    function doNext(arg, error) {
      if (!iterDone) {
          var ret;
          try {
            var ret = Duktape.Thread.resume(thread, arg, error);
            if (ret && ret.__iter) {
                return ret.next;
            }
          }
          catch (e) {
            finish();
            throw e;
          }
          finish(ret);
      }

      return {
          value: doneValue,
          done: true,
      }
    };

    return {
        next(arg) {
          return doNext(arg);
        },
        'throw': function(err) {
          return doNext(err, true)
        }
    };
  `);

  const ast = build({
    YIELDER: argument,
  });

  return ast;
}

function wrapYieldStatement (argument) {
  const build = template(`
    __yield(YIELDED);
  `);
  const ast = build({
    YIELDED: argument || {
      "type": "Identifier",
      "name": "undefined"
    },
  });
  return ast;
}

function startup () {
  const build = template(`
    const __yield = require('duktape-yield').default;
  `);

  const ast = build({
  });
  return ast;
}

module.exports = ({ types: t }) => {
  return {
    visitor: {
      Program: {
        exit(path, state) {
          if (state.yielded) {
            path.node.body.unshift(startup());
          }
        }
      },
      YieldExpression (path, state) {
        state.yielded = true;
        const node = t.cloneNode(path.get("argument").node);
        // path.get(body).set("body", )
        path.replaceWith(wrapYieldStatement(node));
      },
      Method (path, state) {
        return;
        let node = path.node;

        if (!node.generator) return;

        const container = t.functionExpression(
          null,
          [],
          t.cloneNode(node.body, false),
          node.generator,
          node.async,
        );

        path.get("body").set("body", [
          t.returnStatement(
            t.callExpression(container, []),
          ),
        ]);

        // Regardless of whether or not the wrapped function is a an async method
        // or generator the outer function should not be
        node.generator = false;

        // Unwrap the wrapper IIFE's environment so super and this and such still work.
        path
          .get("body.body.0.argument.callee")
          .unwrapFunctionEnvironment();

      },
      Function (path, state) {
        let node = path.node;

        if (!node.generator) return;


        const container = t.functionExpression(
          null,
          [],
          t.cloneNode(node.body, false),
          false,
          node.async,
        );

        node.generator = false;

        path.get("body").set("body",
          wrapDuktapeThread(container)
        );

        // path
        //   .get("body.body.0.declarations.0.init.arguments.0")
        //   .unwrapFunctionEnvironment();
      }
    }
  }
}
