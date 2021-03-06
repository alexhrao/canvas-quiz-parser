#!/usr/bin/env node
import puppeteer from "puppeteer";
import fs from "fs";
import rimraf from "rimraf";
import { getStudents, requestCSV } from "./canvas";
import { parseResponses, generateHtml, ParserOutput, ParseError, generatePDF } from "./conversion";
import { CanvasConfig, Question, Student } from "./types";
import yargs from "yargs";

export interface ParserConfig {
    canvas: CanvasConfig;
    input?: string;
    outDir?: string;
    template?: string;
    chunk: number;
    attemptStrategy: "first"|"last"|"all";
    includeNoSubs: boolean;
    students?: string[];
    verbose: boolean;
    strict: boolean;
    format: ("HTML"|"PDF"|"TXT")[];
};

export interface ParsedOutput {
    questions: Question[];
    students: Student[];
    template: {
        html: string;
        pdfPath?: string;
    };
    html: string[];
    pdfFilePaths?: string[];
};

/**
 * parseQuiz will fetch, parse, and fill in quiz results
 * from Canvas, via the Canvas API. In this case, however,
 * this is returned as a Promise, so that callers need not wait on the
 * results to populate.
 * 
 * For a more fine-grained approach, look at the member functions of each
 * sub module.
 * @param config The Canvas Configuration to use
 * @param outConfig The output configuration to use
 * @returns A Promise that resolves when this function is completely done and disposal is complete.
 */
export default async function parseQuiz(config: ParserConfig): Promise<ParsedOutput> {
    /*
    const evil = String.raw`*\\,:;&$%^#@'<>?,\\\, \\\,\, \\,\, \\\,\\,ℂ◉℗⒴ ℘ⓐṨͲℰ Ⓒℌ◭ℝ◬ℂ⒯℮ℛ ,`;
    console.log(evil.replace(/\\,/gi, '_'));
    return;
    const evil2 = String.raw`Mason Richard Murphy,11896,903262534,sandbox-CS1371,1669,"",2020-03-29 21:18:10 UTC,1,"*\\,:;&$%^#@""'<>?,\\\, \\\,\, \\,\, \\\,\\,ℂ◉℗⒴ ℘ⓐṨͲℰ Ⓒℌ◭ℝ◬ℂ⒯℮ℛ ,"`;
    const out = parse(evil2);
    console.log(out);
    const out1 = out[0][8];
    console.log(out1);
    return;
    */
    /* Steps:
    1. Start up fetching of all the data:
        * Questions
        * CSV Responses
        * Students
    2. Convert the CSV Data
    3. Add in the student data
    4. For each student, generate an array of questions and their answers
    4. Hydrate with questions and corresponding answers
    */
    // 1. Fetching
    // start up browser
    const {
        canvas,
        outDir,
        template: includeTemplate,
        input,
        chunk,
        attemptStrategy,
        includeNoSubs,
        students: studFilter,
        verbose,
        strict,
        format,
    } = config;

    // for each studFilter that has @ prepended, read from that file
    const studentLogins: string[] = studFilter === undefined ? [] : studFilter.flatMap(login => {
        if (login.startsWith("@")) {
            // read the file
            const logins = fs.readFileSync(login.slice(1)).toString();
            return logins.split(/\n/gi);
        } else {
            return [login];
        }
    })
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();

    const output: ParsedOutput = {
        html: [],
        questions: [],
        students: [],
        template: {
            html: "",
            pdfPath: undefined,
        },
        pdfFilePaths: outDir === undefined ? undefined : [],
    };
    if (verbose && outDir !== undefined) {
        console.log("Starting up Puppeteer");
    }
    const launcher = (outDir === undefined || !format.includes("PDF")) ? undefined : puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    if (verbose) {
        console.log("Fetching student responses");
    }
    const csvReporter = input === undefined ? requestCSV(canvas) : Promise.resolve(fs.readFileSync(input).toString());
    if (verbose) {
        console.log("Fetching and Filtering students from canvas");
    }
    const canvasStudents = (await getStudents(canvas))
        .filter(cs => studentLogins.length === 0 || studentLogins.includes(cs.login_id))
        .sort((a, b) => a.login_id.localeCompare(b.login_id));
    if ((verbose || strict) && studentLogins.length !== 0 && canvasStudents.length !== studentLogins.length) {
        const err = `Warning: Number of students to be processed (${canvasStudents.length}) is not the same as the filter (${studentLogins.length})`;
        if (verbose) {
            console.warn(err);
            console.warn("The following students were specified in the filter, but will not be processed:");
            console.warn(studentLogins.filter(s => !canvasStudents.map(cs => cs.login_id).includes(s)).join("\n\t"));
        }
        if (strict) {
            if (launcher !== undefined) {
                await (await launcher).close();
            }
            throw new Error(err);
        }
    }
    // now that we have questions and students, matchmake!
    // Parse their responses, providing the question library.
    // We're guaranteed that every question will be accounted for.
    // 2. We'll have to wait on csv Reporter, but then convert
    if (verbose) {
        console.log("Parsing Responses and Fetching Questions");
    }
    let res = await parseResponses(await csvReporter, canvasStudents, { canvas, attemptStrategy }, strict);
    if (!strict) {
        res = res as ParserOutput;
    } else if (Array.isArray(res)) {
        res = res as ParseError[];
        console.error(res);
        if (launcher !== undefined) {
            await (await launcher).close();
        }
        throw new Error("Parsing Error; check the log");
    } else {
        res = res as ParserOutput;
    }
    const { template, students, questions } = res;
    if ((verbose || strict) && studentLogins.length !== 0 && students.length !== studentLogins.length) {
        const err = `Warning: Number of students to be processed (${canvasStudents.length}) is not the same as the filter (${studentLogins.length})`;
        if (verbose) {
            console.warn(err);
            console.warn("The following students were specified in the filter, but will not be processed:");
            console.warn(studentLogins.filter(s => !canvasStudents.map(cs => cs.login_id).includes(s)).join("\n\t"));
        }
        if (strict) {
            if (launcher !== undefined) {
                await (await launcher).close();
            }
            throw new Error(err);
        }
    }
    output.questions = questions;
    const responses = students.filter(stud => {
        if (includeNoSubs) {
            return true;
        } else {
            return stud.attempt !== 0;
        }
    });
    // stream every chunk students
    if (outDir !== undefined) {
        if (verbose) {
            console.log("Setting up output environment");
        }
        if (fs.existsSync(outDir)) {
            rimraf.sync(outDir);
        }
        fs.mkdirSync(outDir);
    }
    if (format.includes("TXT")) {
        students
            .map(stud => {
                // filter out to only have questions that have a response
                const out: Student = { ...stud };
                out.responses = out.responses
                    .filter(qr => qr.response !== undefined)
                    .filter(qr => qr.response !== null);
                return out;
            })
            .forEach(stud => {
                // create a folder for them.
                fs.mkdirSync(`${outDir}/${stud.login}`);
                // make their files in there
                stud.responses.forEach(resp => {
                    // get the last three characters
                    const qName = `question${resp.question.name.substring(resp.question.name.length - 3, resp.question.name.length - 2)}.txt`;
                    if (Array.isArray(resp.response)) {
                        fs.writeFileSync(`${outDir}/${stud.login}/${qName}`, resp.response.join("\n"));
                    } else {
                        fs.writeFileSync(`${outDir}/${stud.login}/${qName}`, resp.response);
                    }
                });
            });
    }
    // create template:
    let browser = await launcher;
    if (includeTemplate === "include" || includeTemplate === "only") {
        if (verbose) {
            console.log("Generating Template");
        }
        const templateHtml: string = generateHtml([template]);
        output.template.html = templateHtml;
        if (browser !== undefined) {
            await generatePDF(templateHtml, `${outDir}/template.pdf`, browser);
            output.template.pdfPath = "template.pdf";
        }
        if (format.includes("HTML") && outDir !== undefined) {
            fs.writeFileSync(`${outDir}/template.html`, templateHtml);
        }
    }
    if (includeTemplate === "only") {
        if (verbose) {
            console.log("Cleaning up");
        }
        await browser?.close();
        return output;
    }
    output.students = responses;
    responses.sort((s1, s2) => {
        return s1.login.localeCompare(s2.login);
    });
    const chunkSize = chunk === 0 ? 1 : chunk;
    if (verbose) {
        console.log(`Generating student batches: ${chunkSize} per batch`);
    }

    const padSize = (Math.ceil(responses.length / chunkSize)).toString().length;
    for (let i = 0; i < responses.length; i += chunkSize) {
        if (verbose) {
            console.log(`Generating batch #${(i / chunkSize) + 1}/${Math.ceil(responses.length / chunkSize)}`);
        }
        const endInd = i + chunkSize > responses.length ? responses.length : i + chunkSize;
        const overall = generateHtml(responses.slice(i, endInd));
        let pName: string;
        if (chunk !== 0) {
            pName = `${i / chunkSize}`.padStart(padSize, "0");
        } else if (attemptStrategy === "all") {
            const attemptNum = `${responses[i].attempt}`.padStart(padSize, "0");
            pName = `${responses[i].login}_${attemptNum}`;
        } else {
            pName = responses[i].login;
        }
        output.html.push(overall);
        if (browser !== undefined) {
            try {
                if (verbose) {
                    console.log(`Generating PDF for batch #${(i / chunkSize) + 1}`);
                }
                await generatePDF(overall, `${outDir}/${pName}.pdf`, browser);
            } catch {
                // browser failed, but we need to formally close it. remake the browser and attempt again...
                await browser.close();
                browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
                await generatePDF(overall, `${outDir}/${pName}.pdf`, browser);
            }
            output.pdfFilePaths?.push(`${pName}.pdf`);
        }
        if (format.includes("HTML") && outDir !== undefined) {
            fs.writeFileSync(`${outDir}/${pName}.html`, overall);
        }
    }
    if (browser !== undefined) {
        if (verbose) {
            console.log("Cleaning Up");
        }
        await browser.close();
    }
    return output;
}

if (require.main === module) {
    const args = yargs
        .command("[OPTS]", "Parse a Canvas Quiz and Responses into a unified PDF")
        .usage("Usage: $0 -s [SITE] -c [COURSE] -q [QUIZ] -t [TOKEN] [OPTS]")
        .version("2.0.0")
        .option("site", {
            alias: "s",
            describe: "The base site, such as university.instructure.com",
            demandOption: true,
            nargs: 1,
            string: true,
        })
        .option("course", {
            alias: "c",
            describe: "The course ID that this quiz belongs to",
            demandOption: true,
            nargs: 1,
            string: true,
        })
        .option("quiz", {
            alias: "q",
            describe: "The ID of the quiz you would ike parsed",
            demandOption: true,
            nargs: 1,
            string: true,
        })
        .option("token", {
            alias: "t",
            describe: "Your Canvas API Token. Usually begins with 2096~",
            demandOption: true,
            nargs: 1,
            string: true,
        })
        .option("output", {
            alias: "o",
            describe: "The output folder destination. If not given, no files are written",
            demandOption: false,
            nargs: 1,
            string: true,
        })
        .option("format", {
            alias: "f",
            describe: "The format you'd like output to be. Can be PDF, HTML, or TXT. PDF and HTML will generate stylized exams; TXT will instead create a folder for that student, regardless of the chunk size. Only submitted answers will be included",
            demandOption: false,
            nargs: 1,
            string: true,
            array: true,
            default: ["PDF"],
        })
        .option("template", {
            describe: "Include the template. If 'include', then the template, along with all other documents, is printed. If 'only', only the template is provided. Any other value will not include the template.",
            demandOption: false,
            nargs: 1,
            string: true,
            default: "include",
        })
        .option("input", {
            alias: "i",
            describe: "The input CSV file; if none given, we will use the API",
            demandOption: false,
            nargs: 1,
            string: true,
            default: undefined,
        })
        .option("chunk", {
            describe: "The chunk size to use for generating HTML and PDF. If 0, then each student gets their own PDF, which is named <login_id>.pdf",
            demandOption: false,
            nargs: 1,
            number: true,
            default: 10,
        })
        .option("attempt-strategy", {
            describe: "The strategy to use to handle multiple attempts. Can be 'last', 'first', or 'all'. If 'all' is selected, and chunk size is 0, then the attempt number will be appended to the output file name.",
            demandOption: false,
            nargs: 1,
            string: true,
            default: "last",
        })
        .option("include-no-sub", {
            describe: "Whether or not to include students without a submission.",
            demandOption: false,
            nargs: 1,
            boolean: true,
            default: false,
        })
        .option("students", {
            describe: "Student logins to use as a filter. If given multiple times, then multiple students will be filtered. If you have a long list, you can instead give a single filename, prepended with '@', such as '@students.txt'. The file should be newline-separated, with each student login on a newline.",
            demandOption: false,
            array: true,
            string: true,
        })
        .option("verbose", {
            alias: "v",
            describe: "Be more verbose in output",
            demandOption: false,
            default: false,
            boolean: true,
        })
        .option("strict", {
            describe: "Instead of warning, throw an error when a warning condition is met. This happens regardless of the verbosity level",
            demandOption: false,
            default: false,
            boolean: true,
        })
        .help()
        .argv;
    const config: ParserConfig = {
        canvas: {
            course: args.course,
            site: args.site,
            quiz: args.quiz,
            token: args.token,
        },
        outDir: args.output,
        format: args.format.map(str => str.toLocaleUpperCase()) as ("HTML"|"PDF"|"TXT")[],
        input: args.input,
        template: args.template,
        chunk: args.chunk,
        attemptStrategy: args["attempt-strategy"] as "first"|"last"|"all",
        includeNoSubs: args["include-no-sub"],
        students: args.students,
        verbose: args.verbose,
        strict: args.strict,
    };
    parseQuiz(config)
        .catch(r => {
            console.error(r);
        });
}
