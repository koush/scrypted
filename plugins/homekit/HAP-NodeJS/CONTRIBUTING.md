# Contributing

## Guidelines

<!-- Add that once ESLint is set up
* **Coding Standard:** Linting errors are checked by [ESLint][link-eslint].  
    Keeping a consistent style throughout the codebase keeps the cognitive load low for all
    contributors and keeps the code style homogeneous.
-->

* **Node 10 LTS:** `HAP-NodeJS` has a minimum Node version requirement of 10.17.0.
    Pull requests MUST NOT require a Node version greater than that unless the feature is
    enabled/backported via [TypeScript][link-typescript].

* **Add tests:** All pull requests SHOULD include unit tests to ensure the change works as
    expected and to prevent regressions.
    Any pull request containing a bug fix SHOULD include a regression test for the given fix.

* **Document any change in behaviour:** Make sure any documentation is kept up-to-date 
    (JSDoc as well as possible documentation in the [Wiki][wiki]).

* **Consider our release cycle:** Before doing any pull request, please read through our concept for 
    [release cycles][release-cycle]. Especially the section regarding our [Git Workflow][git-workflow].

* **One pull request per feature:** If you want to do more than one thing, send multiple pull requests.
    Otherwise, your pull request could be rejected.

* **Send coherent history:** Make sure each individual commit in your pull request is meaningful.
    If you had to make multiple intermediate commits while developing,
    please [rebase or squash them][link-git-rewrite] before submitting.

## Running tests

In order to contribute, you'll need to checkout the source from GitHub and
install dependencies using npm:

```bash
git clone https://github.com/homebridge/HAP-NodeJS.git
cd HAP-NodeJS
npm install
npm test
```

## Reporting a security vulnerability

See [SECURITY.md](SECURITY.md)

**Happy coding**!

[link-eslint]: https://eslint.org/
[wiki]: https://github.com/homebridge/HAP-NodeJS/wiki
[release-cycle]: https://github.com/homebridge/HAP-NodeJS/wiki/Release-Cycle
[git-workflow]: https://github.com/homebridge/HAP-NodeJS/wiki/Release-Cycle#git-workflow
[link-git-rewrite]: http://www.git-scm.com/book/en/v2/Git-Tools-Rewriting-History#Changing-Multiple-Commit-Messages
