"use strict";

import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import { fakeServerResponse } from "./test_utils.js";
import HTTP from "../src/http.js";

chai.use(chaiAsPromised);
chai.should();
chai.config.includeStack = true;

const root = typeof window === "object" ? window : global;

describe("HTTP class", () => {
  var sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
  });

  afterEach(() => sandbox.restore());

  describe("#request()", () => {
    describe("Request headers", () => {
      beforeEach(() => {
        sandbox.stub(root, "fetch").returns(fakeServerResponse(200, {}, {}));
      });

      it("should set default headers", () => {
        new HTTP().request("/");

        expect(fetch.firstCall.args[1].headers)
          .eql(HTTP.DEFAULT_REQUEST_HEADERS);
      });

      it("should merge custom headers with default ones", () => {
        new HTTP().request("/", {headers: {Foo: "Bar"}});

        expect(fetch.firstCall.args[1].headers.Foo).eql("Bar");
      });
    });

    describe("Succesful request", () => {
      beforeEach(() => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, {a: 1}, {b: 2}));
      });

      it("should resolve with HTTP status", () => {
        return new HTTP().request("/")
          .then(res => res.status)
          .should.eventually.become(200);
      });

      it("should resolve with JSON body", () => {
        return new HTTP().request("/")
          .then(res => res.json)
          .should.eventually.become({a: 1});
      });

      it("should resolve with headers", () => {
        return new HTTP().request("/")
          .then(res => res.headers.get("b"))
          .should.eventually.become(2);
      });
    });

    describe("No content response", () => {
      it("should resolve with null JSON if Content-Length header is missing", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, "", {"Content-Length": undefined}));

        return new HTTP().request("/")
          .then(res => res.json)
          .should.eventually.become(null);
      });

      it("should resolve with null JSON if Content-Length is 0", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, "", {"Content-Length": 0}));

        return new HTTP().request("/")
          .then(res => res.json)
          .should.eventually.become(null);
      });

      it("should resolve with null JSON if Content-Length is '0'", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, "", {"Content-Length": "0"}));

        return new HTTP().request("/")
          .then(res => res.json)
          .should.eventually.become(null);
      });
    });

    describe("Malformed JSON response", () => {
      it("should reject with an appropriate message", () => {
        sandbox.stub(root, "fetch").returns(Promise.resolve({
          status: 200,
          headers: {
            get(name) {
              if (name !== "Alert")
                return "fake";
            }
          },
          json() {
            return JSON.parse("malformed json");
          }
        }));

        return new HTTP().request("/")
          .should.be.rejectedWith(Error, /HTTP 200; SyntaxError: Unexpected token/);
      });
    });

    describe("Business error responses", () => {
      it("should reject on status code > 400", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(400, {
            code: 400,
            details: [
              {
                description: "data is missing",
                location: "body",
                name: "data"
              }
            ],
            errno: 107,
            error: "Invalid parameters",
            message: "data is missing"
        }));

        return new HTTP().request("/")
          .should.be.rejectedWith(Error, /HTTP 400; Invalid request parameter: data is missing/);
      });
    });

    describe("Deprecation header", () => {
      beforeEach(() => {
        sandbox.stub(console, "warn");
      });

      it("should handle deprecation header", () => {
        const eolObject = {
          code:    "soft-eol",
          url:     "http://eos-url",
          message: "This service will soon be decommissioned",
        };
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, {}, {Alert: JSON.stringify(eolObject)}));

        return new HTTP().request("/")
          .then(_ => {
            sinon.assert.calledOnce(console.warn);
            sinon.assert.calledWithExactly(
              console.warn, eolObject.message, eolObject.url);
          });
      });

      it("should handle deprecation header parse error", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, {}, {Alert: "dafuq"}));

        return new HTTP().request("/")
          .then(_ => {
            sinon.assert.calledOnce(console.warn);
            sinon.assert.calledWithExactly(
              console.warn, "Unable to parse Alert header message", "dafuq");
          });
      });
    });

    describe("Backoff header handling", () => {
      var http;

      beforeEach(() => {
        http = new HTTP();
        // Make utils.getUnixTime to always return 1000, for easier computation
        sandbox.stub(Date.prototype, "getTime").returns(1000 * 1000);
        sandbox.stub(http, "emit");
      });

      it("should emit a backoff event on set Backoff header", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, {}, {Backoff: "1000"}));

        return http.request("/").then(_ => {
          expect(http.emit.firstCall.args[0]).eql("backoff");
          expect(http.emit.firstCall.args[1]).eql(2000);
        });
      });

      it("should emit a backoff event on missing Backoff header", () => {
        sandbox.stub(root, "fetch").returns(
          fakeServerResponse(200, {}, {}));

        return http.request("/").then(_ => {
          expect(http.emit.firstCall.args[0]).eql("backoff");
          expect(http.emit.firstCall.args[1]).eql(null);
        });
      });
    });
  });
});
